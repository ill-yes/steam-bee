import { AppError, appError } from "../http/errors.js";
import { steamManager } from "./manager.js";
import type { CommunitySession } from "./community-session.js";
import { createLogger } from "../util/logger.js";

const log = createLogger("steam-community");

type CommunityRequestOptions = {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  shouldContinue?: () => boolean;
};

/** Cookies Steam sets during its market check; never auth cookies. */
const marketCookieNames = new Set(["webTradeEligibility", "steamCountry"]);

export function createCommunityRequest(
  sessionFor: (accountId: string) => Promise<CommunitySession>,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
  discardSession: (accountId: string, sessionId: string) => void = () =>
    undefined,
) {
  // Market cookies belong to one web session and expire with Steam's Max-Age.
  const marketCookies = new Map<
    string,
    {
      sessionId: string;
      cookies: Map<string, { pair: string; expiresAt: number }>;
    }
  >();
  const marketCookiesFor = (accountId: string, sessionId: string) => {
    let entry = marketCookies.get(accountId);
    if (entry?.sessionId !== sessionId) {
      entry = { sessionId, cookies: new Map() };
      marketCookies.set(accountId, entry);
    }
    for (const [name, cookie] of entry.cookies)
      if (cookie.expiresAt <= now()) entry.cookies.delete(name);
    return entry.cookies;
  };
  return async (
    accountId: string,
    path: string,
    init: CommunityRequestOptions = {},
  ): Promise<Response> => {
    const origin = "https://steamcommunity.com";
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\\\r\n\u0000]/.test(path)
    ) {
      throw appError("Invalid Steam Community path.", 400);
    }
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password) {
      throw appError("Invalid Steam Community destination.", 400);
    }
    const session = await sessionFor(accountId);
    // A queued batch may be stopped while Steam renews its web session.
    if (init.shouldContinue && !init.shouldContinue()) {
      throw Object.assign(
        appError("Market batch stopped before submission.", 409),
        {
          notSubmitted: true,
          stopBatch: true,
        },
      );
    }
    const method = init.method ?? "GET";
    const form =
      method === "POST"
        ? new URLSearchParams({ ...init.form, sessionid: session.sessionId })
        : undefined;
    let response: Response;
    try {
      if (init.shouldContinue && !init.shouldContinue()) {
        throw Object.assign(
          appError("Market batch stopped before submission.", 409),
          {
            notSubmitted: true,
            stopBatch: true,
          },
        );
      }
      const extraCookies = marketCookiesFor(accountId, session.sessionId);
      let target = url;
      for (let hop = 0; ; hop++) {
        response = await fetcher(target, {
          method,
          headers: {
            cookie: [
              ...session.cookies,
              ...[...extraCookies.values()].map((cookie) => cookie.pair),
            ].join("; "),
            referer: `${origin}/market/`,
            origin,
            ...(form
              ? {
                  "content-type":
                    "application/x-www-form-urlencoded; charset=UTF-8",
                }
              : {}),
          },
          ...(form ? { body: form } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status < 300 || response.status >= 400) break;
        await response.body?.cancel();
        rememberMarketCookies(response, extraCookies, now());
        // Profiles with a custom URL redirect /profiles/<id>/... to /id/<name>/...,
        // and the market first sends browsers through its eligibility check.
        // Follow only those same-host GET hops.
        const next = communityRedirect(response, target, method, hop);
        if (!next) {
          log.warn(
            {
              status: response.status,
              path: target.pathname,
              redirectPath: redirectPath(response, target),
            },
            "Steam Community redirect rejected",
          );
          // Cached cookies stay valid for 30 minutes; Steam may end them sooner.
          discardSession(accountId, session.sessionId);
          throw appError("Steam Community requires a renewed sign-in.", 409);
        }
        target = next;
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw appError(
              "Steam Community response exceeded the size limit.",
              502,
            );
          }
          chunks.push(chunk.value);
        }
      }
      return new Response(
        [204, 205, 304].includes(response.status)
          ? null
          : Buffer.concat(chunks),
        {
          status: response.status,
          headers: {
            "content-type":
              response.headers.get("content-type") ??
              "application/octet-stream",
          },
        },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Fetch errors can include cookies or request details; never expose them.
      throw appError(
        "Steam Community request failed. Try again after reconnecting.",
        502,
      );
    }
  };
}

const maxRedirects = 3;

function communityRedirect(
  response: Response,
  from: URL,
  method: string,
  hop: number,
): URL | null {
  if (method !== "GET" || hop >= maxRedirects) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return null;
  }
  if (next.origin !== from.origin || next.username || next.password)
    return null;
  const profile = /^\/(?:id|profiles)\/[^/]+\//.test(next.pathname);
  const eligibility = next.pathname === "/market/eligibilitycheck/";
  const backToMarket =
    from.pathname === "/market/eligibilitycheck/" &&
    next.pathname.startsWith("/market/") &&
    !eligibility;
  return profile || eligibility || backToMarket ? next : null;
}

function rememberMarketCookies(
  response: Response,
  cookies: Map<string, { pair: string; expiresAt: number }>,
  now: number,
) {
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = header.split(";");
    const name = pair.slice(0, pair.indexOf("=")).trim();
    if (!marketCookieNames.has(name) || /[\r\n]/.test(pair)) continue;
    const maxAge = attributes
      .map((attribute) => /^\s*max-age=(\d+)\s*$/i.exec(attribute)?.[1])
      .find(Boolean);
    // Without Max-Age the cookie lives for the browser session; keep it an hour.
    const seconds = maxAge === undefined ? 3600 : Number(maxAge);
    if (seconds <= 0) cookies.delete(name);
    else
      cookies.set(name, { pair: pair.trim(), expiresAt: now + seconds * 1000 });
  }
}

/** Path only: query strings can carry return URLs or tokens. */
function redirectPath(response: Response, from: URL): string | null {
  try {
    const next = new URL(response.headers.get("location") ?? "", from);
    return next.origin === from.origin ? next.pathname : next.origin;
  } catch {
    return null;
  }
}

export const communityRequest = createCommunityRequest(
  (accountId) => steamManager.getCommunitySession(accountId),
  fetch,
  Date.now,
  (accountId, sessionId) =>
    steamManager.discardCommunitySession(accountId, sessionId),
);
