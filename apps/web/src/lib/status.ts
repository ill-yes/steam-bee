import type { ReactNode } from "react";
import type { Account, SteamEvent } from "../api";
import { interpolate, type Messages } from "../i18n";

const personaValues = [1, 2, 3, 7] as const;

export const activeStates = new Set(["boosting", "online"]);
export const pausedStates = new Set(["paused_manual", "paused_other_session"]);
export const busyStates = new Set(["connecting", "reconnecting"]);
export const importableStates = new Set(["online", "boosting"]);
export const maxVisibleLibraryRows = 120;

export type EventFilterMode =
  "all" | "status" | "actions" | "library" | "errors";
export type LibraryFilterMode =
  | "all"
  | "selected"
  | "unselected"
  | "played"
  | "unplayed"
  | "favorites"
  | "hidden";
export type LibrarySortMode = "name" | "playtime" | "appid";

export function personaOptions(messages: Messages) {
  const labels = messages.status.personas;
  return personaValues.map((value) => ({
    label: labels[value] ?? String(value),
    value,
  }));
}

export function libraryFilterModes(messages: Messages): Array<{
  label: string;
  value: LibraryFilterMode;
}> {
  const labels = messages.status.libraryFilters;
  return [
    { label: labels.all, value: "all" },
    { label: labels.selected, value: "selected" },
    { label: labels.unselected, value: "unselected" },
    { label: labels.played, value: "played" },
    { label: labels.unplayed, value: "unplayed" },
    { label: labels.favorites, value: "favorites" },
    { label: labels.hidden, value: "hidden" },
  ];
}

export function eventFilterModes(messages: Messages): Array<{
  label: string;
  value: EventFilterMode;
}> {
  const labels = messages.status.eventFilters;
  return [
    { label: labels.all, value: "all" },
    { label: labels.status, value: "status" },
    { label: labels.actions, value: "actions" },
    { label: labels.library, value: "library" },
    { label: labels.errors, value: "errors" },
  ];
}

export function statusLabel(status: string, messages: Messages) {
  const labels: Record<string, string> = messages.status.runtime;
  return labels[status] ?? status;
}

export function statusSummary(
  status: string,
  selectedCount: number,
  messages: Messages,
) {
  if (status === "online" && selectedCount === 0) {
    return messages.status.runtimeSummary.onlineWithoutGames;
  }
  return statusLabel(status, messages);
}

export function desiredLabel(desiredState: string, messages: Messages) {
  const labels: Record<string, string> = messages.status.desired;
  return labels[desiredState] ?? desiredState;
}

export function personaLabel(value: number, messages: Messages) {
  const labels: Record<number, string> = messages.status.personas;
  return labels[value] ?? String(value);
}

export function eventDisplay(event: SteamEvent, messages: Messages) {
  if (event.type === "steam.status") {
    const parsedStatus =
      event.message.match(/^Status geandert: (.+)$/)?.[1] ??
      event.message.match(/^Status geändert: (.+)$/)?.[1] ??
      event.message.match(/^Status ([^:]+):/)?.[1];

    if (parsedStatus) {
      return {
        title: statusEventTitle(parsedStatus, messages),
        body: statusEventBody(parsedStatus, event.message, messages),
      };
    }

    const inferredStatus = statusFromStatusEventMessage(event.message);
    if (inferredStatus) {
      return {
        title: statusEventTitle(inferredStatus, messages),
        body: statusEventBody(inferredStatus, event.message, messages),
      };
    }

    return {
      title: statusEventTitleFromMessage(event.message, messages),
      body: event.message,
    };
  }

  const titles: Record<string, string> = messages.status.eventTitles;

  const title = titles[event.type];
  return {
    title: title ?? titles.fallback,
    body: title ? "" : event.message,
  };
}

export function eventMatchesFilter(event: SteamEvent, filter: EventFilterMode) {
  if (filter === "all") return true;
  if (filter === "errors") return event.level === "error";
  if (filter === "status") return event.type === "steam.status";
  if (filter === "library") return event.type.includes("library");
  if (filter === "actions") {
    return (
      !event.type.includes("library") &&
      event.type !== "steam.status" &&
      event.level !== "error"
    );
  }
  return true;
}

export function getPrimaryCommand(
  status: string,
  selectedCount: number,
  messages: Messages,
): {
  kind: "action" | "focus-games";
  action: "start" | "resume";
  label: string;
  disabled: boolean;
} | null {
  if (busyStates.has(status)) {
    return {
      kind: "action",
      action: "start",
      label: messages.status.primaryCommand.connecting,
      disabled: true,
    };
  }

  if (status === "boosting") return null;

  if (pausedStates.has(status)) {
    return {
      kind: "action",
      action: "resume",
      label: messages.status.primaryCommand.resume,
      disabled: false,
    };
  }

  if (status === "online" && selectedCount === 0) {
    return {
      kind: "focus-games",
      action: "start",
      label: messages.status.primaryCommand.selectGames,
      disabled: false,
    };
  }

  return {
    kind: "action",
    action: "start",
    label:
      selectedCount > 0
        ? messages.status.primaryCommand.startBoosting
        : messages.status.primaryCommand.connect,
    disabled: false,
  };
}

export function nextStepMessage(
  status: string,
  libraryCount: number,
  selectedCount: number,
  messages: Messages,
) {
  const copy = messages.status.nextStep;
  if (status === "error" || status === "login_required") {
    return copy.checkConnection;
  }
  if (busyStates.has(status)) {
    return copy.connecting;
  }
  if (importableStates.has(status) && libraryCount === 0) {
    return copy.importing;
  }
  if (libraryCount > 0 && selectedCount === 0) {
    return copy.chooseGames;
  }
  if (status === "paused_manual") {
    return copy.pausedManual;
  }
  if (status === "paused_other_session") {
    return copy.pausedOther;
  }
  if (selectedCount > 0 && status !== "boosting") {
    return copy.readyToStart;
  }
  if (status === "boosting") {
    return copy.boosting;
  }
  return copy.loginSaved;
}

export function selectionApplyCopy(
  status: string,
  appliedCount: number,
  draftCount: number,
  dirty: boolean,
  applying: boolean,
  messages: Messages,
): {
  label: string;
  body: string;
  tone: "busy" | "applied" | "queued" | "idle" | "dirty";
} {
  const copy = messages.status.selection;
  if (applying) {
    return {
      label: copy.applyingLabel,
      body: copy.applyingBody,
      tone: "busy",
    };
  }

  if (dirty) {
    return {
      label: copy.dirtyLabel,
      body: appliedCount > 0 ? copy.dirtyAppliedBody : copy.dirtyInactiveBody,
      tone: "dirty",
    };
  }

  if (draftCount === 0) {
    return {
      label: copy.emptyLabel,
      body:
        status === "online" || status === "boosting"
          ? copy.emptyOnlineBody
          : copy.emptySavedBody,
      tone: "idle",
    };
  }

  if (status === "boosting") {
    return {
      label: copy.appliedLabel,
      body: copy.appliedBoostingBody,
      tone: "applied",
    };
  }

  if (status === "online") {
    return {
      label: copy.appliedLabel,
      body: copy.appliedOnlineBody,
      tone: "applied",
    };
  }

  if (busyStates.has(status)) {
    return {
      label: copy.waitingLabel,
      body: copy.waitingBody,
      tone: "queued",
    };
  }

  if (pausedStates.has(status)) {
    return {
      label: copy.readyResumeLabel,
      body: copy.readyResumeBody,
      tone: "queued",
    };
  }

  return {
    label: copy.savedForStartLabel,
    body: copy.savedForStartBody,
    tone: "queued",
  };
}

export function libraryEmptyState(status: string, messages: Messages) {
  const copy = messages.status.libraryEmpty;
  if (busyStates.has(status)) {
    return {
      title: copy.connectingTitle,
      body: copy.connectingBody,
    };
  }

  if (importableStates.has(status)) {
    return {
      title: copy.emptyTitle,
      body: copy.emptyBody,
    };
  }

  if (status === "error" || status === "login_required") {
    return {
      title: copy.unavailableTitle,
      body: copy.unavailableBody,
    };
  }

  return {
    title: copy.offlineTitle,
    body: copy.offlineBody,
  };
}

export function accountStats(accounts: Account[]) {
  return {
    total: accounts.length,
    active: accounts.filter((account) =>
      activeStates.has(account.runtimeStatus),
    ).length,
    paused: accounts.filter((account) =>
      pausedStates.has(account.runtimeStatus),
    ).length,
    attention: accounts.filter((account) =>
      ["error", "login_required"].includes(account.runtimeStatus),
    ).length,
  };
}

export function statusTone(status: string) {
  if (status === "boosting" || status === "online") return "good";
  if (busyStates.has(status)) return "info";
  if (pausedStates.has(status)) return "warn";
  if (status === "error" || status === "login_required") return "danger";
  return "neutral";
}

export function statusEventTitle(status: string, messages: Messages) {
  const titles: Record<string, string> = messages.status.statusEventTitle;
  return (
    titles[status] ??
    interpolate(messages.status.statusEventTitle.fallback, {
      status,
    })
  );
}

function statusEventBody(status: string, fallback: string, messages: Messages) {
  const bodies: Record<string, string> = messages.status.statusEventBody;
  if (status === "error") return fallback;
  return bodies[status] ?? fallback;
}

function statusFromStatusEventMessage(message: string) {
  if (
    message.includes("Boosting ist aktiv") ||
    message.includes("Spieleauswahl wird an Steam gemeldet")
  ) {
    return "boosting";
  }
  if (message.includes("Steam-Session ist online")) return "online";
  if (message.includes("Verbindung wird aufgebaut")) return "connecting";
  if (message.includes("erneut aufgebaut")) return "reconnecting";
  if (message.includes("manuell pausiert")) return "paused_manual";
  if (message.includes("anderer Steam-Client")) return "paused_other_session";
  if (message.includes("Steam-Login")) return "login_required";
  if (message.includes("getrennt")) return "disconnected";
  return null;
}

function statusEventTitleFromMessage(message: string, messages: Messages) {
  if (message.includes("Boosting ist aktiv")) {
    return messages.status.statusEventTitle.boosting;
  }
  if (message.includes("Steam-Session ist online")) {
    return messages.status.statusEventTitle.online;
  }
  if (message.includes("Verbindung")) {
    return messages.status.statusEventTitle.connection;
  }
  if (message.includes("Login")) {
    return messages.status.statusEventTitle.login_required;
  }
  return messages.status.statusEventTitle.generic;
}

export type SummaryItemConfig = {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
};
