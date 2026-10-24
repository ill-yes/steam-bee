import {
  lazy,
  Suspense,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Gamepad2, Gift, Package, Layers, ShieldCheck } from "lucide-react";
import type { AccountStatus } from "@steam-bee/contracts";
import type { SteamApp } from "../../api";
import { useI18n } from "../../i18n";
import { FreeGamesWatcher } from "../discovery/FreeGamesWatcher";
import { hubCopy } from "./detail/hubCopy";

const FreeGamesPanel = lazy(() =>
  import("../discovery/FreeGamesPanel").then((module) => ({
    default: module.FreeGamesPanel,
  })),
);
const InventoryPanel = lazy(() =>
  import("../inventory/InventoryPanel").then((module) => ({
    default: module.InventoryPanel,
  })),
);
const FarmingPanel = lazy(() =>
  import("../farming/FarmingPanel").then((module) => ({
    default: module.FarmingPanel,
  })),
);

export type AccountWorkspaceTab =
  "library" | "inventory" | "farming" | "offers" | "account";
type Props = {
  accountId: string;
  library?: SteamApp[] | undefined;
  activityMode?: "idle" | "manual" | "farming" | undefined;
  accountStatus?: AccountStatus | undefined;
  activeTab?: AccountWorkspaceTab;
  onTabChange?: (tab: AccountWorkspaceTab) => void;
  libraryPanel?: ReactNode;
  accountPanel?: ReactNode;
};

export function SteamToolsPanel(props: Props) {
  return <AccountSteamToolsPanel key={props.accountId} {...props} />;
}

function AccountSteamToolsPanel({
  accountId,
  library,
  activityMode,
  accountStatus,
  activeTab: providedTab,
  onTabChange,
  libraryPanel,
  accountPanel,
}: Props) {
  const { locale, localeInfo, messages: t } = useI18n();
  const copy = hubCopy(locale);
  const [localTab, setLocalTab] = useState<AccountWorkspaceTab>("library");
  const activeTab = providedTab ?? localTab;
  const id = useId();
  const buttons = useRef<
    Partial<Record<AccountWorkspaceTab, HTMLButtonElement | null>>
  >({});
  const tabs = [
    { id: "library", label: copy.library, icon: Gamepad2 },
    { id: "inventory", label: copy.inventory, icon: Package },
    { id: "farming", label: copy.farming, icon: Layers },
    { id: "offers", label: copy.offers, icon: Gift },
    { id: "account", label: copy.account, icon: ShieldCheck },
  ] as const;
  function select(tab: AccountWorkspaceTab) {
    if (providedTab === undefined) setLocalTab(tab);
    onTabChange?.(tab);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const forward = event.key === "ArrowRight" ? 1 : -1;
      next =
        (current +
          forward * (localeInfo.dir === "rtl" ? -1 : 1) +
          tabs.length) %
        tabs.length;
    } else return;
    event.preventDefault();
    const tab = tabs[next]!.id;
    select(tab);
    buttons.current[tab]?.focus();
    buttons.current[tab]?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label={copy.workspace}>
      <FreeGamesWatcher accountId={accountId} />
      <div
        role="tablist"
        aria-label={copy.workspace}
        aria-orientation="horizontal"
        className="grid min-w-0 max-w-full grid-cols-2 gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 sm:flex sm:flex-wrap"
      >
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              role="tab"
              key={tab.id}
              id={`${id}-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${id}-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              ref={(node) => {
                buttons.current[tab.id] = node;
              }}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => navigate(event, index)}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-normal rounded-md border px-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:shrink-0 sm:px-3 sm:text-sm ${tab.id === "account" ? "col-span-2 sm:col-span-1" : ""} ${activeTab === tab.id ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-2)]"}`}
            >
              <Icon size={16} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${id}-panel-${tab.id}`}
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {activeTab === tab.id && (
            <Suspense fallback={<p role="status">{t.common.loading}</p>}>
              {tab.id === "library" ? (
                libraryPanel
              ) : tab.id === "account" ? (
                accountPanel
              ) : tab.id === "inventory" ? (
                <InventoryPanel accountId={accountId} />
              ) : tab.id === "offers" ? (
                <FreeGamesPanel accountId={accountId} />
              ) : (
                <FarmingPanel
                  accountId={accountId}
                  library={library}
                  activityMode={activityMode}
                  accountStatus={accountStatus}
                />
              )}
            </Suspense>
          )}
        </div>
      ))}
    </section>
  );
}
