import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Account,
  AdminOverview,
  AdminSession,
  BoostAnalytics,
  BoostPreset,
  BoostSchedule,
  Diagnostics,
  NotificationRule,
  SteamApp,
} from "../src/api";
import { App } from "../src/App";
import { AccountDetail } from "../src/features/accounts/AccountDetail";
import { AccountRail } from "../src/features/accounts/AccountRail";
import { SafetyPanel } from "../src/features/accounts/detail/SafetyPanel";
import { AdminDialog } from "../src/features/admin/AdminDialog";
import { OperationsPanel } from "../src/features/admin/OperationsPanel";
import { I18nProvider } from "../src/i18n";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../src/api", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api")>("../src/api");
  return {
    ...actual,
    api: apiMock,
  };
});

describe("web smoke", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(window.navigator, "languages", {
      value: ["de-DE"],
      configurable: true,
    });
    Object.defineProperty(window.navigator, "language", {
      value: "de-DE",
      configurable: true,
    });
    apiMock.mockReset();
    mockAccountData();
  });

  it("renders the real signed-out application root", async () => {
    renderWithProviders(<App />);

    expect(apiMock).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(
      await screen.findByRole("button", { name: /Sign in|Anmelden/ }),
    ).toBeInTheDocument();
  });

  it("shows a retryable bootstrap error instead of an endless skeleton", async () => {
    apiMock.mockRejectedValueOnce(new Error("Local server unavailable"));
    renderWithProviders(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local server unavailable",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Try again|Erneut versuchen/ }),
    );

    expect(
      await screen.findByRole("button", { name: /Sign in|Anmelden/ }),
    ).toBeInTheDocument();
  });

  it("does not retain the previous account resources while switching", async () => {
    const secondAccount: Account = {
      ...pausedAccount,
      id: "account-2",
      accountName: "second",
      games: [],
    };
    let resolveSecondLibrary: (value: SteamApp[]) => void = () => undefined;
    const secondLibrary = new Promise<SteamApp[]>((resolve) => {
      resolveSecondLibrary = resolve;
    });
    class FakeEventSource {
      onerror: ((event: Event) => void) | null = null;
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/me") {
        return {
          setupComplete: true,
          setupTokenRequired: false,
          authenticated: true,
          csrfToken: "csrf",
        };
      }
      if (path === "/api/accounts") return [pausedAccount, secondAccount];
      if (path === "/api/events/recent") return [];
      if (path === "/api/diagnostics") return diagnostics;
      if (path === "/api/system/status") return readySystemStatus;
      if (path === "/api/notifications/rules") return [];
      if (path.includes("/account-2/library")) return secondLibrary;
      if (path.includes("/account-2/presets")) return [];
      if (path.includes("/account-2/schedules/preview")) {
        return emptySchedulePreview();
      }
      if (path.includes("/account-2/schedules")) return [];
      if (path.includes("/account-2/analytics")) return emptyAnalytics();
      if (path.includes("/account-2/safety")) return safetyPolicy("account-2");
      if (path.includes("/account-2/goals")) return [];
      if (path.endsWith("/library")) return library;
      if (path.endsWith("/presets")) return presets;
      if (path.endsWith("/schedules/preview")) return emptySchedulePreview();
      if (path.endsWith("/schedules")) return schedules;
      if (path.endsWith("/analytics")) return analytics;
      if (path.endsWith("/safety")) return safetyPolicy("account-1");
      if (path.endsWith("/goals")) return [];
      return [];
    });

    try {
      renderWithProviders(<App />);
      expect(await screen.findAllByText("Counter-Strike 2")).not.toHaveLength(
        0,
      );

      fireEvent.change(screen.getByLabelText(/Account|Konto/), {
        target: { value: "account-2" },
      });

      expect(screen.queryByText("Counter-Strike 2")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/Loading|Lädt/);
      resolveSecondLibrary([
        {
          appId: 440,
          name: "Team Fortress 2",
          playtimeForever: 60,
          source: "library",
          favorite: false,
          hidden: false,
          tags: [],
        },
      ]);
      expect(await screen.findByText("Team Fortress 2")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders one resume action for a paused account", () => {
    renderWithProviders(
      <AccountDetail
        account={pausedAccount}
        events={[]}
        diagnostics={diagnostics}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(1);
  });

  it("shows the session-conflict attempt and cooldown state", async () => {
    renderAccountDetail({
      ...pausedAccount,
      status: "reconnecting",
      runtimeStatus: "reconnecting",
      desiredState: "running",
      health: {
        lastSteamContactAt: Date.now(),
        nextRetryAt: Date.now() + 60 * 60_000,
        retryAttempt: 3,
        errorClass: "session_replaced",
        errorCode: 34,
        recoveryAction: "wait",
        libraryImportedAt: null,
      },
    });

    expect(
      await screen.findByText(
        /(Retry attempt|Reconnect-Versuch) 3 \/ 3.*(60-minute cooldown|60-Minuten-Cooldown)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Session replaced|Sitzung wurde ersetzt/),
    ).toBeInTheDocument();
  });

  it("places presets, schedules and analytics inside the boost tools panel without export actions", async () => {
    renderAccountDetail();

    expect(await screen.findByText("Automation & history")).toBeInTheDocument();
    expect(screen.getByText("Boost selection")).toBeInTheDocument();
    expect(screen.getByText("Boost presets")).toBeInTheDocument();
    expect(screen.queryByText("CSV")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Analytics als JSON exportieren"),
    ).not.toBeInTheDocument();

    const scheduleTab = screen.getByRole("button", { name: /Schedule/ });
    expect(scheduleTab).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(scheduleTab);
    expect(scheduleTab).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Schedules")).toBeInTheDocument();
    expect(screen.getByText("Choose preset")).toBeInTheDocument();
    const monday = screen.getByRole("button", { name: "Mon" });
    expect(monday).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(monday);
    expect(monday).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: /Analytics/ }));
    expect(await screen.findByText("Top games")).toBeInTheDocument();
    expect(screen.getByText("Snapshot goals")).toBeInTheDocument();
    expect(screen.getAllByText("Counter-Strike 2").length).toBeGreaterThan(0);
    expect(screen.queryByText("CSV")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Safety/ }));
    expect(await screen.findByText("Session safety")).toBeInTheDocument();
    expect(
      screen.getByText(/caps never start a stopped account/i),
    ).toBeInTheDocument();
  });

  it("rejects invalid safety limits instead of silently clearing them", () => {
    const onSave = vi.fn();
    renderWithProviders(
      <SafetyPanel
        policy={{
          accountId: "account-1",
          maxSessionMinutes: 60,
          maxDailyMinutes: null,
          maxWeeklyMinutes: null,
          pauseUntil: null,
          holdReason: null,
          holdCreatedAt: null,
          updatedAt: Date.now(),
        }}
        busy={false}
        canPauseUntil={false}
        onSave={onSave}
        onPauseUntil={vi.fn()}
      />,
    );

    const sessionLimit = screen.getByLabelText(
      /Maximum session|Maximale Session/,
    );
    const save = screen.getByRole("button", {
      name: /Save safety policy|Safety-Regeln speichern/,
    });
    fireEvent.change(sessionLimit, { target: { value: "4" } });

    expect(sessionLimit).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /whole minutes|Ganze Minuten/,
    );
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(sessionLimit, { target: { value: "" } });
    expect(sessionLimit).toHaveAttribute("aria-invalid", "false");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      maxSessionMinutes: null,
      maxDailyMinutes: null,
      maxWeeklyMinutes: null,
    });
  });

  it("distinguishes optional resource failures from valid empty states", async () => {
    let previewRequests = 0;
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/library")) return library;
      if (path.endsWith("/presets")) return presets;
      if (path.endsWith("/schedules")) return schedules;
      if (path.endsWith("/analytics")) return analytics;
      if (path.includes("/schedules/preview")) {
        previewRequests += 1;
        if (previewRequests === 1) {
          throw new Error("Optional endpoint unavailable");
        }
        return emptySchedulePreview();
      }
      if (path.endsWith("/safety") || path.endsWith("/goals")) {
        throw new Error("Optional endpoint unavailable");
      }
      return [];
    });
    renderAccountDetail();
    await screen.findByText("Boost presets");

    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /operation failed|Aktion ist fehlgeschlagen/i,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Refresh preview|Vorschau aktualisieren/,
      }),
    );
    expect(
      await screen.findByText(
        /No upcoming schedule windows|Keine bevorstehenden Zeitplanfenster/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Analytics/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /operation failed|Aktion ist fehlgeschlagen/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /Safety/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /operation failed|Aktion ist fehlgeschlagen/i,
    );
  });

  it("refreshes valid SSE events even when browser notifications throw", async () => {
    let eventListener: ((event: MessageEvent) => void) | undefined;
    class FakeEventSource {
      onerror: (() => void) | null = null;
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "event") eventListener = listener;
      }
      close() {}
    }
    const originalNotification = window.Notification;
    const notification = Object.assign(
      vi.fn(() => {
        throw new Error("Notification constructor failed");
      }),
      { permission: "granted" as NotificationPermission },
    );
    vi.stubGlobal("EventSource", FakeEventSource);
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: notification,
    });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/me") {
        return {
          setupComplete: true,
          setupTokenRequired: false,
          authenticated: true,
          csrfToken: "csrf",
        };
      }
      if (path === "/api/accounts") return [pausedAccount];
      if (path === "/api/events/recent") return [];
      if (path === "/api/diagnostics") return diagnostics;
      if (path === "/api/system/status") return readySystemStatus;
      if (path === "/api/notifications/rules") {
        return [
          {
            id: crypto.randomUUID(),
            name: "Browser alerts",
            target: "browser",
            enabled: true,
            effectiveEnabled: true,
            effectiveStatus: "healthy",
            failureCount: 0,
            suspendedUntil: null,
            nextRetryAt: null,
            eventTypes: ["steam.session.conflict"],
            webhookConfigured: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }
      if (path.endsWith("/library")) return library;
      if (path.endsWith("/presets")) return presets;
      if (path.includes("/schedules/preview")) return emptySchedulePreview();
      if (path.endsWith("/schedules")) return schedules;
      if (path.endsWith("/analytics")) return analytics;
      if (path.endsWith("/safety")) return safetyPolicy("account-1");
      if (path.endsWith("/goals")) return [];
      return [];
    });

    try {
      renderWithProviders(<App />);
      await screen.findByText("tester");
      expect(eventListener).toBeDefined();
      const accountCallsBefore = apiMock.mock.calls.filter(
        ([path]) => path === "/api/accounts",
      ).length;
      const statusCallsBefore = apiMock.mock.calls.filter(
        ([path]) => path === "/api/system/status",
      ).length;

      await act(async () => {
        eventListener?.(
          new MessageEvent("event", {
            data: JSON.stringify({
              id: crypto.randomUUID(),
              accountId: pausedAccount.id,
              type: "steam.session.conflict",
              level: "warning",
              message: "Another Steam session is active.",
              metadata: {},
              createdAt: Date.now(),
            }),
          }),
        );
      });

      await waitFor(() => {
        expect(
          apiMock.mock.calls.filter(([path]) => path === "/api/accounts"),
        ).toHaveLength(accountCallsBefore + 1);
        expect(
          apiMock.mock.calls.filter(([path]) => path === "/api/system/status"),
        ).toHaveLength(statusCallsBefore + 1);
      });
      expect(notification).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText(/Invalid response|Ungültige Antwort/),
      ).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    }
  });

  it("updates library metadata from the library row actions", async () => {
    renderAccountDetail();

    fireEvent.click(await screen.findByTitle("Favorite"));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/accounts/account-1/library/meta",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ appId: 730, favorite: true }),
        }),
      );
    });
  });

  it("toggles the boost draft when a library row is clicked", async () => {
    renderAccountDetail();

    const libraryGameName = (
      await screen.findAllByText("Counter-Strike 2")
    ).find((element) => element.closest("tr"));
    const checkbox = screen.getByRole("checkbox", {
      name: "Select Counter-Strike 2",
    });

    expect(libraryGameName).toBeDefined();
    expect(checkbox).toBeChecked();
    fireEvent.click(libraryGameName!);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "Select Counter-Strike 2",
        }),
      ).not.toBeChecked(),
    );
  });

  it("filters the imported library without losing the current selection", async () => {
    renderAccountDetail();

    const search = await screen.findByLabelText("Search library");
    fireEvent.change(search, { target: { value: "missing game" } });
    expect(await screen.findByText("No result.")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "730" } });
    expect(
      await screen.findByRole("checkbox", {
        name: "Select Counter-Strike 2",
      }),
    ).toBeChecked();
  });

  it("adds a valid manual AppID and applies it with the current draft", async () => {
    renderAccountDetail();

    const input = await screen.findByLabelText("Add AppID");
    fireEvent.change(input, { target: { value: "440" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("");
    expect(await screen.findByText("App 440")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply selection" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/accounts/account-1/games",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ appIds: [730, 440] }),
        }),
      );
    });
  });

  it("blocks another AppID at the game limit while keeping removal available", async () => {
    const accountAtLimit: Account = {
      ...pausedAccount,
      games: Array.from({ length: 32 }, (_, index) => ({
        appId: index === 0 ? 730 : 10_000 + index,
        enabled: true,
        source: "manual" as const,
      })),
    };
    renderAccountDetail(accountAtLimit);

    await screen.findByLabelText("Add AppID");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select Counter-Strike 2" }),
    ).not.toBeDisabled();
  });

  it("keeps library organization simple without tag controls", async () => {
    renderAccountDetail();

    await screen.findByTitle("Favorite");
    expect(screen.queryByTitle("Tags bearbeiten")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tag filtern")).not.toBeInTheDocument();
  });

  it("creates a preset from the current draft selection", async () => {
    renderAccountDetail();

    fireEvent.change(await screen.findByLabelText("Preset name"), {
      target: { value: "Idle Evening" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/accounts/account-1/presets",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Idle Evening",
            appIds: [730],
            personaState: 7,
            customTitle: null,
          }),
        }),
      );
    });
  });

  it("keeps the account confirmation open when removal fails", async () => {
    renderAccountDetail();

    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
    apiMock.mockRejectedValueOnce(new Error("Account removal failed"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(
      await screen.findByText("Account removal failed"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByText(
        "Account removal failed",
      ),
    ).toBeInTheDocument();
  });

  it("shows the admin action in the account rail", () => {
    const onOpenAdmin = vi.fn();
    const { rerender } = renderWithProviders(
      <AccountRail
        accounts={[pausedAccount]}
        selected={pausedAccount}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onOpenAdmin={onOpenAdmin}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open admin area" }));
    expect(onOpenAdmin).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Admin")).toBeInTheDocument();

    rerender(
      <AccountRail
        accounts={[pausedAccount]}
        selected={pausedAccount}
        collapsed
        onToggleCollapsed={vi.fn()}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onOpenAdmin={onOpenAdmin}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open admin area" }),
    ).toBeInTheDocument();
  });

  it("opens admin data, changes password and confirms destructive log actions", async () => {
    const onChanged = vi.fn();
    renderWithProviders(
      <AdminDialog onClose={vi.fn()} onChanged={onChanged} />,
    );

    expect(await screen.findByText("Admin area")).toBeInTheDocument();
    expect(await screen.findByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Admin sessions")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "correct horse battery staple updated" },
    });
    fireEvent.change(screen.getByLabelText("Repeat new password"), {
      target: { value: "correct horse battery staple updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/password",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            currentPassword: "correct horse battery staple",
            newPassword: "correct horse battery staple updated",
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(await screen.findByText("Current test log")).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText("Delete log")[0]!);

    expect(await screen.findByText("Delete log entry?")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete log",
      }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/events/1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("preserves password input after a failed password change", async () => {
    renderWithProviders(<AdminDialog onClose={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("Admin sessions");
    const currentPassword = screen.getByLabelText("Current password");
    const newPassword = screen.getByLabelText("New password");
    const confirmPassword = screen.getByLabelText("Repeat new password");
    fireEvent.change(currentPassword, {
      target: { value: "old-password-value" },
    });
    fireEvent.change(newPassword, {
      target: { value: "new-password-value" },
    });
    fireEvent.change(confirmPassword, {
      target: { value: "new-password-value" },
    });
    apiMock.mockRejectedValueOnce(new Error("Password update failed"));

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText("Password update failed"),
    ).toBeInTheDocument();
    expect(currentPassword).toHaveValue("old-password-value");
    expect(newPassword).toHaveValue("new-password-value");
    expect(confirmPassword).toHaveValue("new-password-value");
  });

  it("keeps a destructive confirmation open after a failed mutation", async () => {
    renderWithProviders(<AdminDialog onClose={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("Admin sessions");
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    fireEvent.click((await screen.findAllByLabelText("Delete log"))[0]!);
    apiMock.mockRejectedValueOnce(new Error("Delete failed"));

    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete log",
      }),
    );

    expect(await screen.findByText("Delete failed")).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByText("Delete failed"),
    ).toBeInTheDocument();
  });

  it("offers resume for paused accounts in the admin accounts tab", async () => {
    renderWithProviders(<AdminDialog onClose={vi.fn()} onChanged={vi.fn()} />);

    await screen.findByText("Admin area");
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/accounts/account-1/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("activates a new browser notification rule in the current app session", async () => {
    const onChanged = vi.fn(async () => undefined);
    const originalNotification = window.Notification;
    const requestPermission = vi.fn(async () => "granted" as const);
    const notification = Object.assign(vi.fn(), {
      permission: "granted" as NotificationPermission,
      requestPermission,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: notification,
    });

    try {
      renderWithProviders(
        <AdminDialog onClose={vi.fn()} onChanged={onChanged} />,
      );
      await screen.findByText("Admin area");
      fireEvent.click(
        screen.getByRole("button", { name: /Operations|Betrieb/ }),
      );
      expect(
        await screen.findByText(/Webhook name|Webhook-Name/, {
          selector: "label",
        }),
      ).toBeVisible();
      expect(
        screen.getByText(/Webhook URL|Webhook-URL/, { selector: "label" }),
      ).toBeVisible();
      fireEvent.click(
        await screen.findByRole("button", {
          name: /Enable browser alerts|Browser-Hinweise aktivieren/,
        }),
      );

      await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith(
          "/api/notifications/rules",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              name: "Browser alerts",
              target: "browser",
              enabled: true,
              eventTypes: [
                "steam.status.login_required",
                "steam.session.conflict",
                "steam.schedule.error",
                "steam.safety.cap",
                "steam.status.error",
              ],
            }),
          }),
        ),
      );
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    }
  });

  it("requests one browser-rule upsert when enable is clicked twice", async () => {
    const existingRule: NotificationRule = {
      id: "00000000-0000-4000-8000-000000000020",
      name: "Legacy translated browser name",
      target: "browser",
      enabled: true,
      effectiveEnabled: false,
      effectiveStatus: "suspended",
      failureCount: 5,
      suspendedUntil: Date.now() + 60_000,
      nextRetryAt: null,
      eventTypes: ["steam.status.error"],
      webhookConfigured: false,
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now(),
    };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/account-groups") return [];
      if (path === "/api/notifications/rules") return [existingRule];
      return { ok: true };
    });
    const originalNotification = window.Notification;
    const requestPermission = vi.fn(async () => "granted" as const);
    const toLocaleString = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("localized date");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(vi.fn(), {
        permission: "granted" as NotificationPermission,
        requestPermission,
      }),
    });

    try {
      renderWithProviders(
        <OperationsPanel
          overview={adminOverview}
          onNotificationRulesChanged={vi.fn()}
        />,
      );
      const enable = await screen.findByRole("button", {
        name: /Enable browser alerts|Browser-Hinweise aktivieren/,
      });
      fireEvent.click(enable);
      fireEvent.click(enable);

      await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith(
          "/api/notifications/rules",
          expect.objectContaining({ method: "POST" }),
        ),
      );
      expect(
        apiMock.mock.calls.filter(
          ([path, options]) =>
            path === "/api/notifications/rules" && options?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        apiMock.mock.calls.filter(
          ([path, options]) =>
            path === `/api/notifications/rules/${existingRule.id}` &&
            options?.method === "PUT",
        ),
      ).toHaveLength(0);
      const health = screen.getByText(/Suspended|Ausgesetzt/);
      expect(health).not.toHaveClass("truncate");
      expect(screen.getByText("Legacy translated browser name")).toHaveClass(
        "truncate",
      );
      expect(toLocaleString).toHaveBeenCalledWith("en-US");
    } finally {
      toLocaleString.mockRestore();
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    }
  });

  it("confirms account-group deletion before issuing the request", async () => {
    const group = {
      id: "00000000-0000-4000-8000-000000000010",
      name: "Weekend hold",
      accountIds: ["account-1"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/account-groups") return [group];
      if (path === "/api/notifications/rules") return [];
      return { ok: true };
    });
    renderWithProviders(
      <OperationsPanel
        overview={adminOverview}
        onNotificationRulesChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: /Pause group: Weekend hold|Gruppe pausieren: Weekend hold/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Stop group: Weekend hold|Gruppe stoppen: Weekend hold/,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Delete group: Weekend hold|Gruppe löschen: Weekend hold/,
      }),
    );
    expect(apiMock).not.toHaveBeenCalledWith(
      `/api/account-groups/${group.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: /Delete|Löschen/,
      }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/account-groups/${group.id}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});

function renderAccountDetail(account: Account = pausedAccount) {
  return renderWithProviders(
    <AccountDetail
      account={account}
      events={[]}
      diagnostics={diagnostics}
      onReload={vi.fn(async () => undefined)}
    />,
  );
}

function renderWithProviders(ui: ReactNode) {
  return render(ui, { wrapper: I18nProvider });
}

function mockAccountData() {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/me") {
      return {
        setupComplete: true,
        setupTokenRequired: false,
        authenticated: false,
        csrfToken: null,
      };
    }
    if (path.endsWith("/library/meta")) return { ok: true };
    if (path === "/api/admin/overview") return adminOverview;
    if (path === "/api/admin/sessions") return adminSessions;
    if (path === "/api/admin/password") return { revokedSessions: 1 };
    if (path.startsWith("/api/admin/")) return { ok: true };
    if (path.endsWith("/presets") && init?.method === "POST") {
      return { ...presets[0], name: "Idle Evening" };
    }
    if (path.endsWith("/library")) return library;
    if (path.endsWith("/presets")) return presets;
    if (path.endsWith("/schedules")) return schedules;
    if (path.includes("/schedules/preview")) {
      return {
        generatedAt: Date.now(),
        through: Date.now(),
        timezoneCount: 1,
        items: [],
      };
    }
    if (path.endsWith("/analytics")) return analytics;
    if (path.endsWith("/safety")) {
      return {
        accountId: "account-1",
        maxSessionMinutes: null,
        maxDailyMinutes: null,
        maxWeeklyMinutes: null,
        pauseUntil: null,
        holdReason: "manual",
        holdCreatedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    if (path.endsWith("/goals")) return [];
    return [];
  });
}

const pausedAccount: Account = {
  id: "account-1",
  accountName: "tester",
  steamId: "76561198000000000",
  status: "paused_manual",
  runtimeStatus: "paused_manual",
  desiredState: "paused",
  personaState: 7,
  customTitle: null,
  activePresetId: null,
  tokenExpiresAt: Date.now() + 1_000_000,
  lastError: null,
  latestBoostStartedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  games: [{ appId: 730, enabled: true, source: "manual" }],
};

const library: SteamApp[] = [
  {
    appId: 730,
    name: "Counter-Strike 2",
    playtimeForever: 677_580,
    source: "library",
    favorite: false,
    hidden: false,
    tags: [],
  },
];

const presets: BoostPreset[] = [
  {
    id: "preset-1",
    accountId: "account-1",
    name: "Evening",
    personaState: 7,
    customTitle: null,
    appIds: [730],
    games: [{ appId: 730, name: "Counter-Strike 2" }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const schedules: BoostSchedule[] = [
  {
    id: "schedule-1",
    accountId: "account-1",
    presetId: "preset-1",
    presetName: "Evening",
    name: "Werktag",
    enabled: true,
    weekdays: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "18:00",
    timezone: "Europe/Berlin",
    lastStartedWindow: null,
    lastStoppedWindow: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const analytics: BoostAnalytics = {
  todayMs: 30 * 60_000,
  last7DaysMs: 8 * 60_000,
  totalSessions: 2,
  openSession: null,
  topGames: [{ appId: 730, name: "Counter-Strike 2", durationMs: 8 * 60_000 }],
  recentSessions: [
    {
      id: "session-1",
      presetId: "preset-1",
      presetName: "Evening",
      appIds: [730],
      apps: [{ appId: 730, name: "Counter-Strike 2" }],
      startedAt: Date.now() - 8 * 60_000,
      endedAt: Date.now(),
      stopReason: "paused_manual",
      durationMs: 8 * 60_000,
    },
  ],
};

const readySystemStatus = {
  code: "SYSTEM_READY" as const,
  label: "System ready",
  tone: "good" as const,
  detail: "Ready",
  pendingMigrations: 0,
  accountErrors: 0,
  recentErrors: 0,
  checkedAt: Date.now(),
};

function emptyAnalytics(): BoostAnalytics {
  return {
    todayMs: 0,
    last7DaysMs: 0,
    totalSessions: 0,
    openSession: null,
    topGames: [],
    recentSessions: [],
  };
}

function emptySchedulePreview() {
  return {
    generatedAt: Date.now(),
    through: Date.now(),
    timezoneCount: 0,
    items: [],
  };
}

function safetyPolicy(accountId: string) {
  return {
    accountId,
    maxSessionMinutes: null,
    maxDailyMinutes: null,
    maxWeeklyMinutes: null,
    pauseUntil: null,
    holdReason: null,
    holdCreatedAt: null,
    updatedAt: Date.now(),
  };
}

const diagnostics: Diagnostics = {
  build: {
    version: "0.1.0-test",
    revision: "test",
    buildDate: "2026-07-09T00:00:00Z",
  },
  logging: {
    level: "info",
    requests: false,
    quietRequests: true,
  },
  runtime: {
    dataDir: "/data",
    publicDir: "/public",
    sseClients: 0,
  },
  migrations: {
    current: null,
    latest: null,
    pending: [],
    unsupported: [],
  },
  events: {
    sampleSize: 0,
    lastEventAt: null,
    byLevel: {},
    byCategory: {},
  },
  accounts: {
    total: 1,
    desiredRunning: 0,
  },
};

const adminSessions: AdminSession[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    current: true,
    createdAt: Date.now() - 60_000,
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    current: false,
    createdAt: Date.now() - 120_000,
    lastSeenAt: Date.now() - 30_000,
    expiresAt: Date.now() + 7 * 24 * 60 * 60_000,
  },
];

const adminOverview: AdminOverview = {
  generatedAt: Date.now(),
  totals: {
    accounts: 1,
    sessions: 2,
    events: 1,
    presets: 1,
    schedules: 1,
    appCache: 1,
    libraryEntries: 1,
    selectedGames: 1,
  },
  sessions: adminSessions,
  accounts: [
    {
      ...pausedAccount,
      selectedGameCount: 1,
      libraryAppCount: 1,
      presetCount: 1,
      scheduleCount: 1,
      eventCount: 1,
    },
  ],
  events: [
    {
      id: 1,
      accountId: "account-1",
      level: "info",
      type: "admin.test",
      message: "Current test log",
      metadata: {},
      createdAt: Date.now(),
    },
  ],
  presets: [
    {
      id: "preset-1",
      accountId: "account-1",
      accountName: "tester",
      name: "Evening",
      personaState: 7,
      customTitle: null,
      appCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  schedules: [
    {
      id: "schedule-1",
      accountId: "account-1",
      accountName: "tester",
      presetId: "preset-1",
      presetName: "Evening",
      name: "Werktag",
      enabled: true,
      weekdays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
      timezone: "Europe/Berlin",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  apps: [
    {
      appId: 730,
      name: "Counter-Strike 2",
      playtimeForever: 677_580,
      source: "library",
      updatedAt: Date.now(),
      libraryAccountCount: 1,
      selectedAccountCount: 1,
      presetCount: 1,
    },
  ],
};
