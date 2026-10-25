import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Gamepad2,
  Gift,
  Layers,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from "lucide-react";
import type { AccountStatus } from "@steam-bee/contracts";
import type { SteamApp } from "../../api";
import { interpolate, useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
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
  | "library"
  | "farming"
  | "inventory"
  | "listings"
  | "rules"
  | "offers"
  | "planning"
  | "account";
type InventoryView = "inventory" | "listings" | "rules";
type Props = {
  accountId: string;
  library?: SteamApp[] | undefined;
  activityMode?: "idle" | "manual" | "farming" | undefined;
  accountStatus?: AccountStatus | undefined;
  activeTab?: AccountWorkspaceTab;
  onTabChange?: (tab: AccountWorkspaceTab) => void;
  remainingDrops?: number | null | undefined;
  libraryPanel?: ReactNode;
  planningPanel?: ReactNode;
  accountPanel?: ReactNode;
  onSwitchToFarming?: (() => void) | undefined;
};

const inventoryViews = new Set<AccountWorkspaceTab>([
  "inventory",
  "listings",
  "rules",
]);

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
  remainingDrops,
  libraryPanel,
  planningPanel,
  accountPanel,
  onSwitchToFarming,
}: Props) {
  const { locale, messages: t } = useI18n();
  const copy = hubCopy(locale);
  const id = useId();
  const [localTab, setLocalTab] = useState<AccountWorkspaceTab>("library");
  const activeTab = providedTab ?? localTab;
  function select(tab: AccountWorkspaceTab) {
    if (providedTab === undefined) setLocalTab(tab);
    onTabChange?.(tab);
  }
  const groups: {
    label: string;
    items: {
      id: AccountWorkspaceTab;
      label: string;
      icon: LucideIcon;
      count?: string | undefined;
    }[];
  }[] = [
    {
      label: copy.navActivity,
      items: [
        { id: "library", label: copy.library, icon: Gamepad2 },
        {
          id: "farming",
          label: copy.farming,
          icon: Layers,
          count:
            remainingDrops && remainingDrops > 0
              ? interpolate(copy.dropsCount, { count: remainingDrops })
              : undefined,
        },
      ],
    },
    {
      label: copy.navItems,
      items: [
        { id: "inventory", label: copy.inventoryNav, icon: Package },
        { id: "listings", label: copy.listings, icon: Store },
        { id: "rules", label: copy.rules, icon: SlidersHorizontal },
      ],
    },
    {
      label: copy.navDiscover,
      items: [{ id: "offers", label: copy.offers, icon: Gift }],
    },
    {
      label: copy.navAccount,
      items: [
        ...(planningPanel
          ? [
              {
                id: "planning" as const,
                label: copy.planning,
                icon: CalendarClock,
              },
            ]
          : []),
        { id: "account", label: copy.account, icon: ShieldCheck },
      ],
    },
  ];
  const panelLabel =
    groups.flatMap((group) => group.items).find((item) => item.id === activeTab)
      ?.label ?? copy.workspace;

  return (
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
      <FreeGamesWatcher accountId={accountId} />
      <nav
        aria-label={copy.navLabel}
        className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 lg:sticky lg:top-20"
      >
        <div className="flex min-w-0 gap-1 overflow-x-auto lg:grid lg:gap-3 lg:overflow-visible">
          {groups.map((group) => (
            <div
              key={group.label}
              role="group"
              aria-labelledby={`${id}-${group.label}`}
              className="flex shrink-0 gap-1 lg:grid lg:gap-0.5"
            >
              <span
                id={`${id}-${group.label}`}
                className="sr-only px-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] lg:not-sr-only lg:pb-1"
              >
                {group.label}
              </span>
              {group.items.map((item) => {
                const Icon = item.icon;
                const current = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={current ? "page" : undefined}
                    onClick={() => select(item.id)}
                    className={cn(
                      "flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-start text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:min-h-9 lg:whitespace-normal",
                      current
                        ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                        : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                    )}
                  >
                    <Icon size={16} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {item.count && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[11px] font-bold",
                          current
                            ? "bg-[var(--surface)] text-[var(--ink)]"
                            : "bg-[var(--info-soft)] text-[var(--info)]",
                        )}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
      <section aria-label={panelLabel} className="min-w-0">
        <Suspense fallback={<p role="status">{t.common.loading}</p>}>
          {activeTab === "library" ? (
            libraryPanel
          ) : activeTab === "planning" ? (
            planningPanel
          ) : activeTab === "account" ? (
            accountPanel
          ) : inventoryViews.has(activeTab) ? (
            <InventoryPanel
              accountId={accountId}
              view={activeTab as InventoryView}
              onViewChange={select}
            />
          ) : activeTab === "offers" ? (
            <FreeGamesPanel accountId={accountId} />
          ) : (
            <FarmingPanel
              accountId={accountId}
              library={library}
              activityMode={activityMode}
              accountStatus={accountStatus}
              onSwitchToFarming={onSwitchToFarming}
            />
          )}
        </Suspense>
      </section>
    </div>
  );
}
