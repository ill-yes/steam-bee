import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, SteamEvent } from "../src/api";
import { AddAccountModal } from "../src/features/accounts/AddAccountModal";
import { I18nProvider } from "../src/i18n";

const apiMock = vi.hoisted(() => vi.fn());
const qrCodeMock = vi.hoisted(() => ({ toDataURL: vi.fn() }));
const serverConnectedAt = 1_700_000_000_000;

vi.mock("../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api")>("../src/api");
  return { ...actual, api: apiMock };
});

vi.mock("qrcode", () => ({ default: qrCodeMock }));

describe("add account flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
    qrCodeMock.toDataURL.mockReset();
    qrCodeMock.toDataURL.mockResolvedValue("data:image/png;base64,steam-qr");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts QR login, renders the code and handles authentication once", async () => {
    const onDone = vi.fn(async () => undefined);
    let loginPolls = 0;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/qr/start") {
        return { loginId: "login-1", qrUrl: "steam://qr/1" };
      }
      if (path === "/api/steam/login/login-1") {
        loginPolls += 1;
        return {
          status: "authenticated",
          accountId: "account-1",
          accountName: "Bee",
          connectedAt: serverConnectedAt,
        };
      }
      if (path === "/api/accounts") return [account("connecting")];
      if (path === "/api/events/recent") return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onDone });
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();

    expect(apiMock).toHaveBeenCalledWith(
      "/api/steam/login/qr/start",
      expect.objectContaining({ method: "POST", signal: expect.anything() }),
    );
    expect(qrCodeMock.toDataURL).toHaveBeenCalledWith("steam://qr/1", {
      width: 196,
      margin: 1,
    });
    expect(screen.getByRole("img", { name: "Steam QR" })).toHaveAttribute(
      "src",
      "data:image/png;base64,steam-qr",
    );

    await advance(2_000);

    expect(screen.getByText("Steam is connecting.")).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(loginPolls).toBe(1);

    await advance(6_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(loginPolls).toBe(1);
  });

  it("never overlaps QR polling requests", async () => {
    const firstPoll = deferred<{ status: string }>();
    let loginPolls = 0;
    apiMock.mockImplementation((path: string): Promise<unknown> | unknown => {
      if (path === "/api/steam/login/qr/start") {
        return { loginId: "login-2", qrUrl: "steam://qr/2" };
      }
      if (path === "/api/steam/login/login-2") {
        loginPolls += 1;
        return loginPolls === 1
          ? firstPoll.promise
          : Promise.resolve({ status: "pending" });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    await advance(10_000);

    expect(loginPolls).toBe(1);

    firstPoll.resolve({ status: "pending" });
    await flushAsyncWork();
    await advance(1_999);
    expect(loginPolls).toBe(1);
    await advance(1);
    expect(loginPolls).toBe(2);
  });

  it("submits credentials without an empty Guard code and shows pending state", async () => {
    apiMock.mockResolvedValue({ status: "guard_required" });
    renderModal();
    openCredentials();
    fillCredentials();

    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    const credentialCall = apiMock.mock.calls.find(
      ([path]) => path === "/api/steam/login/credentials",
    );
    expect(credentialCall).toBeDefined();
    expect(credentialCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        signal: expect.anything(),
        body: JSON.stringify({
          accountName: "bee",
          password: "secret-value",
        }),
      }),
    );
    expect(
      screen.getByText("Steam Guard code required or login still pending."),
    ).toBeVisible();
  });

  it("moves through connecting, importing and done without duplicate callbacks", async () => {
    const onDone = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const stages = [
      { status: "connecting" as const, events: [] as SteamEvent[] },
      { status: "online" as const, events: [] as SteamEvent[] },
      {
        status: "online" as const,
        events: [libraryEvent("steam.library.import")],
      },
    ];
    let stageIndex = 0;
    let activeStage = stages[0]!;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") {
        activeStage = stages[Math.min(stageIndex, stages.length - 1)]!;
        stageIndex += 1;
        return [account(activeStage.status)];
      }
      if (path === "/api/events/recent") return activeStage.events;
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onClose, onDone });
    openCredentials();
    fillCredentials("12345");
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(screen.getByText("Steam is connecting.")).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(1);

    await advance(2_000);
    expect(
      screen.getByText("Steam is online. Importing library."),
    ).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(2);

    await advance(2_000);
    expect(screen.getByText("Library imported")).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(3);

    await advance(899);
    expect(onClose).not.toHaveBeenCalled();
    await advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(3);
  });

  it("uses server connection time when client and server clocks differ", async () => {
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    const onClose = vi.fn();
    let events = [
      libraryEvent("steam.library.import.error", serverConnectedAt - 1),
    ];
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") return [account("online")];
      if (path === "/api/events/recent") return events;
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onClose });
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(
      screen.getByText("Steam is online. Importing library."),
    ).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    events = [libraryEvent("steam.library.import", serverConnectedAt)];
    await advance(2_000);
    expect(screen.getByText("Library imported")).toBeVisible();
    await advance(900);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a deferred poll result from a superseded QR flow", async () => {
    const oldPoll = deferred<{
      status: string;
      accountId: string;
      accountName: string;
      connectedAt: number;
    }>();
    const onDone = vi.fn(async () => undefined);
    let starts = 0;
    apiMock.mockImplementation((path: string): Promise<unknown> | unknown => {
      if (path === "/api/steam/login/qr/start") {
        starts += 1;
        return {
          loginId: starts === 1 ? "old-login" : "new-login",
          qrUrl: starts === 1 ? "steam://qr/old" : "steam://qr/new",
        };
      }
      if (path === "/api/steam/login/old-login") return oldPoll.promise;
      if (path === "/api/steam/login/new-login") {
        return Promise.resolve({ status: "pending" });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onDone });
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    await advance(2_000);

    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    oldPoll.resolve({
      status: "authenticated",
      accountId: "stale-account",
      accountName: "Stale Bee",
      connectedAt: serverConnectedAt,
    });
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Account Stale Bee saved. Steam is connecting."),
    ).not.toBeInTheDocument();
    expect(qrCodeMock.toDataURL).toHaveBeenLastCalledWith("steam://qr/new", {
      width: 196,
      margin: 1,
    });
  });

  it("invalidates an in-flight QR poll when switching to credentials", async () => {
    const oldPoll = deferred<{
      status: string;
      accountId: string;
      accountName: string;
      connectedAt: number;
    }>();
    const onDone = vi.fn(async () => undefined);
    let pollSignal: AbortSignal | undefined;
    apiMock.mockImplementation(
      (path: string, init?: RequestInit): Promise<unknown> | unknown => {
        if (path === "/api/steam/login/qr/start") {
          return { loginId: "switch-login", qrUrl: "steam://qr/switch" };
        }
        if (path === "/api/steam/login/switch-login") {
          pollSignal = init?.signal ?? undefined;
          return oldPoll.promise;
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );

    renderModal({ onDone });
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    await advance(2_000);
    expect(pollSignal?.aborted).toBe(false);

    openCredentials();
    expect(pollSignal?.aborted).toBe(true);
    oldPoll.resolve({
      status: "authenticated",
      accountId: "stale-account",
      accountName: "Stale Bee",
      connectedAt: serverConnectedAt,
    });
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Account Stale Bee saved. Steam is connecting."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toBeVisible();
  });

  it("aborts an in-flight credential login and clears secrets when switching to QR", async () => {
    const credentialRequest = deferred<{
      status: string;
      accountId: string;
      connectedAt: number;
    }>();
    const onDone = vi.fn(async () => undefined);
    let credentialSignal: AbortSignal | undefined;
    apiMock.mockImplementation(
      (path: string, init?: RequestInit): Promise<unknown> => {
        if (path === "/api/steam/login/credentials") {
          credentialSignal = init?.signal ?? undefined;
          return credentialRequest.promise;
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      },
    );

    renderModal({ onDone });
    openCredentials();
    fillCredentials("12345");
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    expect(credentialSignal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "QR login" }));
    expect(credentialSignal?.aborted).toBe(true);
    credentialRequest.resolve({
      status: "authenticated",
      accountId: "stale-account",
      connectedAt: serverConnectedAt,
    });
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText("QR login has not started yet.")).toBeVisible();

    openCredentials();
    expect(screen.getByLabelText("Account name")).toHaveValue("bee");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Steam Guard code")).toHaveValue("");
  });

  it("clears password and Guard code immediately after authentication", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") return [account("connecting")];
      if (path === "/api/events/recent") return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal();
    openCredentials();
    fillCredentials("12345");
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(screen.getByLabelText("Account name")).toHaveValue("bee");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Steam Guard code")).toHaveValue("");
  });

  it("does not leak a normal error from a superseded start request", async () => {
    const oldStart = deferred<{ loginId: string; qrUrl: string }>();
    apiMock.mockImplementation((path: string): Promise<unknown> | unknown => {
      if (path === "/api/steam/login/qr/start") return oldStart.promise;
      if (path === "/api/steam/login/credentials") {
        return Promise.resolve({ status: "guard_required" });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    oldStart.reject(new Error("Stale QR failure"));
    await flushAsyncWork();

    expect(screen.queryByText("Stale QR failure")).not.toBeInTheDocument();
    expect(
      screen.getByText("Steam Guard code required or login still pending."),
    ).toBeVisible();
  });

  it.each(["login_required", "paused_manual", "disconnected"] as const)(
    "treats %s as a terminal connection status",
    async (status) => {
      let progressPolls = 0;
      apiMock.mockImplementation(async (path: string) => {
        if (path === "/api/steam/login/credentials") {
          return authenticatedCredential();
        }
        if (path === "/api/accounts") {
          progressPolls += 1;
          return [account(status)];
        }
        if (path === "/api/events/recent") return [];
        throw new Error(`Unexpected request: ${path}`);
      });

      renderModal();
      openCredentials();
      fillCredentials();
      fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
      await flushAsyncWork();

      expect(screen.getByText("Steam connection failed.")).toBeVisible();
      await advance(6_000);
      expect(progressPolls).toBe(1);
    },
  );

  it("retries a failed final refresh and closes only after it succeeds", async () => {
    const onClose = vi.fn();
    let doneCalls = 0;
    const onDone = vi.fn(async () => {
      doneCalls += 1;
      if (doneCalls === 2) throw new Error("Final refresh failed");
    });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") return [account("online")];
      if (path === "/api/events/recent") {
        return [libraryEvent("steam.library.import")];
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onClose, onDone });
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(screen.getByText("Library imported")).toBeVisible();
    expect(screen.getByText("Final refresh failed")).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(2);
    await advance(1_999);
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    await advance(1);
    expect(onDone).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Final refresh failed")).not.toBeInTheDocument();
    await advance(899);
    expect(onClose).not.toHaveBeenCalled();
    await advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears a transient QR poll error after polling recovers", async () => {
    let polls = 0;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/qr/start") {
        return { loginId: "recovering-login", qrUrl: "steam://qr/recover" };
      }
      if (path === "/api/steam/login/recovering-login") {
        polls += 1;
        if (polls === 1) throw new Error("Temporary poll failure");
        return { status: "pending" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    await advance(2_000);
    expect(screen.getByText("Temporary poll failure")).toBeVisible();

    await advance(2_000);
    expect(
      screen.queryByText("Temporary poll failure"),
    ).not.toBeInTheDocument();
    expect(polls).toBe(2);
  });

  it("serializes onDone notifications from different milestones", async () => {
    const firstNotification = deferred<void>();
    let activeNotifications = 0;
    let maximumActiveNotifications = 0;
    let notificationCount = 0;
    const onDone = vi.fn(async () => {
      notificationCount += 1;
      activeNotifications += 1;
      maximumActiveNotifications = Math.max(
        maximumActiveNotifications,
        activeNotifications,
      );
      if (notificationCount === 1) await firstNotification.promise;
      activeNotifications -= 1;
    });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") return [account("online")];
      if (path === "/api/events/recent") return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onDone });
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(maximumActiveNotifications).toBe(1);
    firstNotification.resolve();
    await flushAsyncWork();
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(maximumActiveNotifications).toBe(1);
  });

  it("stops QR polling after a terminal login error", async () => {
    let loginPolls = 0;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/qr/start") {
        return { loginId: "login-error", qrUrl: "steam://qr/error" };
      }
      if (path === "/api/steam/login/login-error") {
        loginPolls += 1;
        return { status: "error" };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    await flushAsyncWork();
    await advance(2_000);

    expect(screen.getByText("QR login failed.")).toBeVisible();
    await advance(10_000);
    expect(loginPolls).toBe(1);
  });

  it("surfaces account connection errors and stops progress polling", async () => {
    const onDone = vi.fn(async () => undefined);
    let progressPolls = 0;
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") {
        progressPolls += 1;
        return [account("error", "Steam exploded")];
      }
      if (path === "/api/events/recent") return [];
      throw new Error(`Unexpected request: ${path}`);
    });

    renderModal({ onDone });
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();

    expect(screen.getByText("Steam exploded")).toBeVisible();
    expect(onDone).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(progressPolls).toBe(1);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("aborts in-flight work and ignores late results after unmount", async () => {
    const startRequest = deferred<{ loginId: string; qrUrl: string }>();
    const onDone = vi.fn(async () => undefined);
    const onClose = vi.fn();
    let startSignal: AbortSignal | undefined;
    apiMock.mockImplementation(
      (path: string, init?: RequestInit): Promise<unknown> => {
        if (path !== "/api/steam/login/qr/start") {
          return Promise.reject(new Error(`Unexpected request: ${path}`));
        }
        startSignal = init?.signal ?? undefined;
        return startRequest.promise;
      },
    );

    const view = renderModal({ onClose, onDone });
    fireEvent.click(screen.getByRole("button", { name: "Start QR" }));
    expect(startSignal?.aborted).toBe(false);

    view.unmount();
    expect(startSignal?.aborted).toBe(true);
    startRequest.resolve({ loginId: "late", qrUrl: "steam://qr/late" });
    await flushAsyncWork();
    await advance(10_000);

    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(qrCodeMock.toDataURL).not.toHaveBeenCalled();
  });

  it("clears the delayed close callback when unmounted", async () => {
    const onClose = vi.fn();
    let activeStage = {
      status: "online" as const,
      events: [libraryEvent("steam.library.import")],
    };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/steam/login/credentials") {
        return authenticatedCredential();
      }
      if (path === "/api/accounts") return [account(activeStage.status)];
      if (path === "/api/events/recent") return activeStage.events;
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = renderModal({ onClose });
    openCredentials();
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Connect once" }));
    await flushAsyncWork();
    expect(screen.getByText("Library imported")).toBeVisible();

    view.unmount();
    activeStage = { ...activeStage, events: [] };
    await advance(1_000);
    expect(onClose).not.toHaveBeenCalled();
  });
});

function renderModal({
  onClose = vi.fn(),
  onDone = vi.fn(async () => undefined),
}: {
  onClose?: () => void;
  onDone?: () => Promise<void>;
} = {}) {
  return render(<AddAccountModal onClose={onClose} onDone={onDone} />, {
    wrapper: I18nProvider,
  });
}

function openCredentials() {
  fireEvent.click(screen.getByRole("button", { name: "Fallback" }));
}

function fillCredentials(guardCode = "") {
  fireEvent.change(screen.getByLabelText("Account name"), {
    target: { value: "bee" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret-value" },
  });
  if (guardCode) {
    fireEvent.change(screen.getByLabelText("Steam Guard code"), {
      target: { value: guardCode },
    });
  }
}

function authenticatedCredential(accountId = "account-1") {
  return {
    status: "authenticated",
    accountId,
    connectedAt: serverConnectedAt,
  };
}

async function flushAsyncWork() {
  await act(async () => {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      await Promise.resolve();
    }
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function account(
  runtimeStatus: Account["runtimeStatus"],
  lastError: string | null = null,
): Account {
  return {
    id: "account-1",
    accountName: "bee",
    steamId: "76561198000000000",
    status: runtimeStatus,
    runtimeStatus,
    desiredState: "running",
    personaState: 7,
    customTitle: null,
    activePresetId: null,
    tokenExpiresAt: null,
    lastError,
    latestBoostStartedAt: null,
    createdAt: 1,
    updatedAt: 1,
    games: [],
  };
}

function libraryEvent(type: string, createdAt = Date.now()): SteamEvent {
  return {
    id: 1,
    accountId: "account-1",
    level: type.endsWith(".error") ? "error" : "info",
    type,
    message: type,
    metadata: {},
    createdAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
