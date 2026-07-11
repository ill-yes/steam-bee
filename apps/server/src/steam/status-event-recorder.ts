import type { AccountStatus } from "@steam-bee/contracts";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { steamEvent } from "../db/schema.js";
import { logEventFailure, recordEvent } from "../http/events.js";
import { createLogger, errorLogFields } from "../util/logger.js";
import { redactText } from "../util/redact.js";
import type { WorkerStatusPayload } from "./types.js";

type RecordedStatus = {
  signature: string;
  recordedAt: number;
};

type MetadataProvider = (accountId: string) => Record<string, unknown>;

const statusDedupeWindowMs = 5 * 60_000;
const logger = createLogger("steam-status-events");

export class SteamStatusEventRecorder {
  private readonly lastRecordedStatuses = new Map<string, RecordedStatus>();

  constructor(private readonly metadataFor: MetadataProvider) {}

  async record(payload: WorkerStatusPayload) {
    const { accountId } = payload;
    const message = redactText(
      steamStatusEventMessage(payload.status, payload.error),
    );
    const signature = `${payload.status}:${message}`;
    const now = Date.now();

    if (this.isRecentInMemoryDuplicate(accountId, signature, now)) return;

    try {
      const storedAt = await this.findRecentStoredDuplicate(
        accountId,
        payload.status,
        message,
        now,
      );
      if (storedAt !== null) {
        this.remember(accountId, signature, storedAt);
        return;
      }
    } catch (error) {
      logger.error(
        errorLogFields(error, { accountId, status: payload.status }),
        "Failed to check for duplicate Steam status events",
      );
    }

    try {
      await recordEvent({
        accountId,
        level: payload.error ? "error" : "info",
        type: "steam.status",
        message,
        metadata: {
          ...this.metadataFor(accountId),
          status: payload.status,
          hasError: Boolean(payload.error),
        },
      });
      this.remember(accountId, signature, now);
    } catch (error) {
      logEventFailure(error, {
        accountId,
        eventType: "steam.status",
        status: payload.status,
      });
    }
  }

  clearAccount(accountId: string) {
    this.lastRecordedStatuses.delete(accountId);
  }

  clearAll() {
    this.lastRecordedStatuses.clear();
  }

  private isRecentInMemoryDuplicate(
    accountId: string,
    signature: string,
    now: number,
  ) {
    const previous = this.lastRecordedStatuses.get(accountId);
    if (
      previous?.signature === signature &&
      now - previous.recordedAt < statusDedupeWindowMs
    ) {
      logger.debug({ accountId }, "Skipping duplicate status event");
      return true;
    }
    return false;
  }

  private async findRecentStoredDuplicate(
    accountId: string,
    status: AccountStatus,
    message: string,
    now: number,
  ) {
    const [latest] = await db
      .select({
        message: steamEvent.message,
        createdAt: steamEvent.createdAt,
      })
      .from(steamEvent)
      .where(
        and(
          eq(steamEvent.accountId, accountId),
          eq(steamEvent.type, "steam.status"),
        ),
      )
      .orderBy(desc(steamEvent.createdAt))
      .limit(1);

    if (
      latest?.message === message &&
      now - latest.createdAt < statusDedupeWindowMs
    ) {
      logger.debug(
        { accountId, status },
        "Skipping recently stored duplicate status event",
      );
      return latest.createdAt;
    }

    return null;
  }

  private remember(accountId: string, signature: string, recordedAt: number) {
    this.lastRecordedStatuses.set(accountId, { signature, recordedAt });
  }
}

export function steamStatusEventMessage(status: AccountStatus, error?: string) {
  if (error) {
    return `${statusLabel(status)}: ${error}`;
  }

  const messages: Record<AccountStatus, string> = {
    disconnected: "Steam session is disconnected.",
    connecting: "Steam connection is starting.",
    online: "Steam session is online.",
    boosting: "Active game selection is being reported to Steam.",
    paused_manual: "Boosting was paused manually.",
    paused_other_session: "Paused because another Steam client is active.",
    login_required: "Steam login must be renewed.",
    reconnecting: "Steam connection is reconnecting.",
    error: "Steam session is in an error state.",
  };
  return messages[status];
}

function statusLabel(status: AccountStatus) {
  const labels: Record<AccountStatus, string> = {
    disconnected: "Not connected",
    connecting: "Connecting",
    online: "Online",
    boosting: "Boosting active",
    paused_manual: "Paused manually",
    paused_other_session: "Another Steam client active",
    login_required: "Login required",
    reconnecting: "Reconnect",
    error: "Error",
  };
  return labels[status];
}
