import { ERROR_CODES } from "@steam-bee/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  steamAccount,
  steamAccountGame,
  steamAccountLibrary,
  steamAppCache,
} from "../../db/schema.js";
import { recordInfoEvent } from "../events.js";
import { requireAuth } from "../plugins.js";
import { appError } from "../errors.js";
import { getQrLogin, startQrLogin } from "../../steam/login.js";
import { type OperationContext, steamManager } from "../../steam/manager.js";
import { replaceSelectedGames } from "../../steam/repository.js";
import {
  accountIdParams,
  credentialsLoginSchema,
  enforceGameLimit,
  gameUpdateSchema,
  libraryMetaSchema,
  settingsSchema,
} from "../../steam/validation.js";
import { createLogger } from "../../util/logger.js";

const routeLogger = createLogger("routes");
const qrLoginRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute",
      groupId: "steam-qr-login",
    },
  },
};
const credentialLoginRateLimit = {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: "1 minute",
      groupId: "steam-credential-login",
    },
  },
};

type SteamProfile = {
  steamId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
};

const profileCache = new Map<
  string,
  { expiresAt: number; profile: SteamProfile }
>();
const profileCacheTtlMs = 60 * 60_000;

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", { preHandler: requireAuth }, async () => {
    const accounts = await db.select().from(steamAccount);
    const games = await db.select().from(steamAccountGame);
    return accounts.map((account) => ({
      ...sanitizeAccount(account),
      runtimeStatus: steamManager.getStatus(account.id),
      games: games.filter((game) => game.accountId === account.id),
    }));
  });

  app.delete(
    "/api/accounts/:id",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      await steamManager
        .forget(params.id, operationContext(request, "account-delete"))
        .catch(() => undefined);
      await db.delete(steamAccount).where(eq(steamAccount.id, params.id));
      return { ok: true };
    },
  );

  app.post(
    "/api/steam/login/qr/start",
    { preHandler: requireAuth, ...qrLoginRateLimit },
    async (request) => {
      return startQrLogin(operationContext(request, "steam-login-qr"));
    },
  );

  app.get(
    "/api/steam/login/:loginId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = z
        .object({ loginId: z.string().uuid() })
        .parse(request.params);
      const state = getQrLogin(params.loginId);
      if (!state)
        return reply.code(404).send({
          error: "Login session was not found.",
          code: ERROR_CODES.notFound,
        });
      return state;
    },
  );

  app.post(
    "/api/steam/login/credentials",
    { preHandler: requireAuth, ...credentialLoginRateLimit },
    async (request) => {
      const body = credentialsLoginSchema.parse(request.body);
      const { CredentialLoginFlow } = await import("../../steam/login.js");
      const flow = new CredentialLoginFlow(
        operationContext(request, "steam-login-credentials"),
      );
      return flow.start(body.accountName, body.password, body.guardCode);
    },
  );

  registerAccountCommands(app);

  app.put(
    "/api/accounts/:id/settings",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const body = settingsSchema.parse(request.body);
      const existingGames = await db
        .select()
        .from(steamAccountGame)
        .where(eq(steamAccountGame.accountId, params.id));
      enforceGameLimit(
        existingGames.filter((game) => game.enabled).map((game) => game.appId),
        body.customTitle,
      );

      await db
        .update(steamAccount)
        .set({
          personaState: body.personaState,
          customTitle: body.customTitle || null,
          activePresetId: null,
          updatedAt: Date.now(),
        })
        .where(eq(steamAccount.id, params.id));
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.settings.update",
        message: "Display settings saved.",
        metadata: {
          ...operationContext(request, "settings-update"),
          personaState: body.personaState,
          customTitleEnabled: Boolean(body.customTitle?.trim()),
        },
      });
      await steamManager.refreshWorker(
        params.id,
        operationContext(request, "settings-update"),
      );
      return { ok: true };
    },
  );

  app.get(
    "/api/accounts/:id/library",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const apps = await db
        .select({
          appId: steamAppCache.appId,
          name: steamAppCache.name,
          playtimeForever: steamAccountLibrary.playtimeForever,
          source: steamAccountLibrary.source,
          favorite: steamAccountLibrary.favorite,
          hidden: steamAccountLibrary.hidden,
          tagsJson: steamAccountLibrary.tagsJson,
        })
        .from(steamAccountLibrary)
        .innerJoin(
          steamAppCache,
          eq(steamAppCache.appId, steamAccountLibrary.appId),
        )
        .where(eq(steamAccountLibrary.accountId, params.id));

      return apps
        .map((app) => ({
          ...app,
          tags: parseStringArray(app.tagsJson),
          tagsJson: undefined,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
  );

  app.get(
    "/api/accounts/:id/profile",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const account = await db.query.steamAccount.findFirst({
        where: eq(steamAccount.id, params.id),
      });
      if (!account) {
        throw appError(
          "Steam account was not found.",
          404,
          ERROR_CODES.accountNotFound,
        );
      }
      return getSteamProfile(account.steamId, account.accountName);
    },
  );

  app.post(
    "/api/accounts/:id/library/import",
    { preHandler: requireAuth },
    async (request, reply) => {
      const params = accountIdParams.parse(request.params);
      const status = steamManager.getStatus(params.id);
      if (status !== "online" && status !== "boosting") {
        return reply.code(409).send({
          error:
            "The account is not connected to Steam yet. Wait until it is online or restart the session.",
          code: ERROR_CODES.steamNotConnected,
        });
      }
      return steamManager.importLibrary(
        params.id,
        operationContext(request, "library-import"),
      );
    },
  );

  app.put(
    "/api/accounts/:id/games",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const body = gameUpdateSchema.parse(request.body);
      const appIds = [...new Set(body.appIds)];
      const account = await db.query.steamAccount.findFirst({
        where: eq(steamAccount.id, params.id),
      });
      if (!account) {
        throw appError(
          "Steam account was not found.",
          404,
          ERROR_CODES.accountNotFound,
        );
      }
      enforceGameLimit(appIds, account.customTitle);

      const now = Date.now();
      replaceSelectedGames({
        accountId: params.id,
        appIds,
        source: "manual",
        activePresetId: null,
        now,
      });
      await recordInfoEvent({
        accountId: params.id,
        type: "steam.games.update",
        message: `${appIds.length} games saved to the boost selection.`,
        metadata: {
          ...operationContext(request, "games-update"),
          appCount: appIds.length,
        },
      });
      await steamManager.refreshWorker(
        params.id,
        operationContext(request, "games-update"),
      );
      return { ok: true };
    },
  );

  app.put(
    "/api/accounts/:id/library/meta",
    { preHandler: requireAuth },
    async (request) => {
      const params = accountIdParams.parse(request.params);
      const body = libraryMetaSchema.parse(request.body);
      const [libraryEntry] = await db
        .select()
        .from(steamAccountLibrary)
        .where(
          and(
            eq(steamAccountLibrary.accountId, params.id),
            eq(steamAccountLibrary.appId, body.appId),
          ),
        )
        .limit(1);
      if (!libraryEntry) {
        throw appError(
          "Library entry was not found.",
          404,
          ERROR_CODES.notFound,
        );
      }

      await db
        .update(steamAccountLibrary)
        .set({
          ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
          ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
          ...(body.tags !== undefined
            ? { tagsJson: JSON.stringify([...new Set(body.tags)]) }
            : {}),
        })
        .where(
          and(
            eq(steamAccountLibrary.accountId, params.id),
            eq(steamAccountLibrary.appId, body.appId),
          ),
        );
      return { ok: true };
    },
  );
}

function registerAccountCommands(app: FastifyInstance) {
  const commands: Array<{
    name: "start" | "pause" | "resume" | "stop";
    run: (accountId: string, context: OperationContext) => Promise<void>;
  }> = [
    {
      name: "start",
      run: (accountId, context) => steamManager.start(accountId, context),
    },
    {
      name: "pause",
      run: (accountId, context) => steamManager.pause(accountId, context),
    },
    {
      name: "resume",
      run: (accountId, context) => steamManager.resume(accountId, context),
    },
    {
      name: "stop",
      run: (accountId, context) => steamManager.stop(accountId, context),
    },
  ];

  for (const command of commands) {
    app.post(
      `/api/accounts/:id/${command.name}`,
      { preHandler: requireAuth },
      async (request) => {
        const params = accountIdParams.parse(request.params);
        routeLogger.info(
          {
            accountId: params.id,
            command: command.name,
            correlationId: request.id,
          },
          "Account command requested",
        );
        await command.run(
          params.id,
          operationContext(request, `account-${command.name}`),
        );
        return { ok: true };
      },
    );
  }
}

function operationContext(
  request: FastifyRequest,
  action: string,
): OperationContext {
  return {
    correlationId: request.id,
    source: "api",
    action,
  };
}

function parseStringArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function sanitizeAccount(account: typeof steamAccount.$inferSelect) {
  const {
    tokenCiphertext,
    tokenIv,
    tokenAuthTag,
    tokenKeyVersion,
    ...safeAccount
  } = account;
  void tokenCiphertext;
  void tokenIv;
  void tokenAuthTag;
  void tokenKeyVersion;
  return safeAccount;
}

async function getSteamProfile(
  steamId: string | null,
  accountName: string,
): Promise<SteamProfile> {
  const fallback: SteamProfile = {
    steamId,
    displayName: accountName,
    profileUrl: steamId
      ? `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`
      : null,
    avatarUrl: null,
  };

  if (!steamId) return fallback;

  const cached = profileCache.get(steamId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(
        `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/?xml=1`,
        {
          headers: { "user-agent": "SteamBee profile lookup" },
          signal: controller.signal,
        },
      );

      if (!response.ok) return fallback;

      const xml = await response.text();
      const profile: SteamProfile = {
        steamId,
        displayName: readXmlTag(xml, "steamID") ?? accountName,
        profileUrl:
          readXmlTag(xml, "profileURL") ??
          `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`,
        avatarUrl:
          readXmlTag(xml, "avatarFull") ?? readXmlTag(xml, "avatarMedium"),
      };
      profileCache.set(steamId, {
        expiresAt: Date.now() + profileCacheTtlMs,
        profile,
      });
      return profile;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return fallback;
  }
}

function readXmlTag(xml: string, tag: string) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(
      `<${escapedTag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${escapedTag}>`,
      "i",
    ),
  );
  const rawValue = match?.[1] ?? match?.[2];
  if (!rawValue) return null;
  return rawValue
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}
