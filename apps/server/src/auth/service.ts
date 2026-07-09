import { randomBytes, randomUUID } from "node:crypto";
import { desc, eq, lte, ne } from "drizzle-orm";
import { ERROR_CODES } from "@steam-bee/contracts";
import { hash, verify } from "@node-rs/argon2";
import { db, sqlite } from "../db/client.js";
import { adminSession, adminUser } from "../db/schema.js";
import { appError } from "../http/errors.js";
import { sha256 } from "../util/crypto.js";
import { createLogger } from "../util/logger.js";
import { assertSetupToken, completeSetupToken } from "./setup-token.js";

const SESSION_DAYS = 7;
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const authLogger = createLogger("auth");

export type SessionResult = {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: number;
};

export async function isSetupComplete(): Promise<boolean> {
  const user = await db.query.adminUser.findFirst();
  return Boolean(user);
}

export async function setupAdmin(
  password: string,
  setupToken: string,
): Promise<void> {
  if (await isSetupComplete()) {
    throw appError(
      "Setup has already been completed.",
      409,
      ERROR_CODES.setupComplete,
    );
  }
  assertSetupToken(setupToken);
  const now = Date.now();
  const passwordHash = await hash(password);
  const createAdmin = sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT id FROM admin_user LIMIT 1").get();
    if (existing) {
      throw appError(
        "Setup has already been completed.",
        409,
        ERROR_CODES.setupComplete,
      );
    }

    sqlite
      .prepare(
        `
          INSERT INTO admin_user (
            id, singleton_key, password_hash, created_at, updated_at
          ) VALUES (?, 1, ?, ?, ?)
        `,
      )
      .run(randomUUID(), passwordHash, now, now);
  });

  try {
    createAdmin();
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw appError(
        "Setup has already been completed.",
        409,
        ERROR_CODES.setupComplete,
      );
    }
    throw error;
  }

  completeSetupToken();
  authLogger.info("Admin setup completed");
}

export async function createSession(password: string): Promise<SessionResult> {
  const user = await db.query.adminUser.findFirst();
  if (!user) {
    authLogger.warn("Login attempted before setup");
    throw appError(
      "Setup is not complete yet.",
      409,
      ERROR_CODES.setupRequired,
    );
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    authLogger.warn("Login rejected because password was invalid");
    throw appError("Invalid password.", 401, ERROR_CODES.loginInvalid);
  }

  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sessionId = randomUUID();

  await db.insert(adminSession).values({
    id: sessionId,
    tokenHash: sha256(token),
    csrfToken,
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
  });

  authLogger.info({ sessionId, expiresAt }, "Admin session created");
  return { sessionId, token, csrfToken, expiresAt };
}

export async function validateSession(token: string | undefined) {
  if (!token) return null;

  const now = Date.now();
  await cleanupExpiredSessions(now);

  const session = await db.query.adminSession.findFirst({
    where: eq(adminSession.tokenHash, sha256(token)),
  });
  if (!session) return null;

  if (now - session.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS) {
    await db
      .update(adminSession)
      .set({ lastSeenAt: now })
      .where(eq(adminSession.id, session.id));
  }

  return session;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = sha256(token);
  const session = await db.query.adminSession.findFirst({
    where: eq(adminSession.tokenHash, tokenHash),
  });
  await db.delete(adminSession).where(eq(adminSession.tokenHash, tokenHash));
  if (session) {
    authLogger.info({ sessionId: session.id }, "Admin session deleted");
  }
}

export async function cleanupExpiredSessions(now = Date.now()) {
  const expired = await db
    .select({ id: adminSession.id })
    .from(adminSession)
    .where(lte(adminSession.expiresAt, now));
  if (expired.length === 0) return 0;

  await db.delete(adminSession).where(lte(adminSession.expiresAt, now));
  authLogger.info(
    { expiredSessions: expired.length },
    "Expired admin sessions removed",
  );
  return expired.length;
}

export async function listAdminSessions(currentSessionId: string) {
  const sessions = await db
    .select({
      id: adminSession.id,
      expiresAt: adminSession.expiresAt,
      createdAt: adminSession.createdAt,
      lastSeenAt: adminSession.lastSeenAt,
    })
    .from(adminSession)
    .orderBy(desc(adminSession.lastSeenAt));

  return sessions.map((session) => ({
    ...session,
    current: session.id === currentSessionId,
  }));
}

export async function deleteAdminSessionById(
  sessionId: string,
  currentSessionId: string,
) {
  if (sessionId === currentSessionId) {
    throw appError(
      "The current session cannot be deleted here.",
      409,
      ERROR_CODES.currentSessionProtected,
    );
  }

  const session = await db.query.adminSession.findFirst({
    where: eq(adminSession.id, sessionId),
  });
  if (!session) return false;

  await db.delete(adminSession).where(eq(adminSession.id, sessionId));
  authLogger.info({ sessionId }, "Admin session revoked");
  return true;
}

export async function deleteOtherAdminSessions(currentSessionId: string) {
  const sessions = await db
    .select({ id: adminSession.id })
    .from(adminSession)
    .where(ne(adminSession.id, currentSessionId));

  if (sessions.length === 0) return 0;

  await db.delete(adminSession).where(ne(adminSession.id, currentSessionId));
  authLogger.info(
    { currentSessionId, revokedSessions: sessions.length },
    "Other admin sessions revoked",
  );
  return sessions.length;
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
  currentSessionId: string,
) {
  const user = await db.query.adminUser.findFirst();
  if (!user) {
    throw appError(
      "Setup is not complete yet.",
      409,
      ERROR_CODES.setupRequired,
    );
  }

  const valid = await verify(user.passwordHash, currentPassword);
  if (!valid) {
    authLogger.warn(
      "Password change rejected because current password was invalid",
    );
    throw appError(
      "Current password is invalid.",
      401,
      ERROR_CODES.currentPasswordInvalid,
    );
  }

  await db
    .update(adminUser)
    .set({
      passwordHash: await hash(newPassword),
      updatedAt: Date.now(),
    })
    .where(eq(adminUser.id, user.id));

  const revokedSessions = await deleteOtherAdminSessions(currentSessionId);
  authLogger.info(
    { userId: user.id, revokedSessions },
    "Admin password changed",
  );
  return { revokedSessions };
}

function isUniqueConstraint(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    String(error.code).startsWith("SQLITE_CONSTRAINT")
  );
}
