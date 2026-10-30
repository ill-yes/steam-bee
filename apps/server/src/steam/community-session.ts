import { ERROR_CODES } from "@steam-bee/contracts";
import { appError } from "../http/errors.js";

export type CommunitySession = {
  steamId: string;
  sessionId: string;
  cookies: string[];
};

/** Credentials stay in memory and belong to one live Steam connection. */
export class CommunitySessionBroker {
  private cached: (CommunitySession & { createdAt: number }) | null = null;
  private pending: {
    promise: Promise<CommunitySession>;
    resolve: (session: CommunitySession) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(
    private readonly adapter: {
      steamId: () => string | null;
      connected: () => boolean;
      webLogOn: () => void;
    },
    private readonly timeoutMs = 20_000,
  ) {}

  get(): Promise<CommunitySession> {
    const steamId = this.adapter.steamId();
    if (!this.adapter.connected() || !steamId) {
      this.invalidate();
      return Promise.reject(this.unavailable());
    }
    if (
      this.cached?.steamId === steamId &&
      Date.now() - this.cached.createdAt < 30 * 60_000
    ) {
      return Promise.resolve(this.copy(this.cached));
    }
    if (this.pending) return this.pending.promise;
    let resolve!: (session: CommunitySession) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<CommunitySession>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => this.invalidate(), this.timeoutMs);
    timer.unref();
    this.pending = { promise, resolve, reject, timer };
    try {
      this.adapter.webLogOn();
    } catch {
      this.invalidate();
    }
    return promise;
  }

  accept(sessionId: string, cookies: string[]) {
    const steamId = this.adapter.steamId();
    if (!this.adapter.connected() || !steamId) return;
    if (!sessionId || /[\r\n;]/.test(sessionId)) return;
    const pairs = cookies.map((cookie) => cookie.split(";")[0] ?? "");
    if (
      pairs.some((cookie) => /[\r\n]/.test(cookie)) ||
      !pairs.some((cookie) => cookie.startsWith("steamLoginSecure=")) ||
      !pairs.includes(`sessionid=${sessionId}`)
    )
      return;
    this.cached = { steamId, sessionId, cookies: pairs, createdAt: Date.now() };
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(this.copy(this.cached));
      this.pending = null;
    }
  }

  /** Drops a session Steam rejected, unless a newer one replaced it already. */
  discard(sessionId: string) {
    if (this.cached?.sessionId === sessionId) this.cached = null;
  }

  invalidate() {
    this.cached = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.unavailable());
      this.pending = null;
    }
  }

  private copy(session: CommunitySession): CommunitySession {
    return {
      steamId: session.steamId,
      sessionId: session.sessionId,
      cookies: [...session.cookies],
    };
  }

  private unavailable() {
    return appError(
      "Connect the Steam account to obtain a Community session.",
      409,
      ERROR_CODES.steamNotConnected,
    );
  }
}
