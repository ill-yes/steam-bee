import { X } from "lucide-react";
import type { Diagnostics, SteamEvent } from "../../api";
import { Button } from "../../components/ui/button";
import { useI18n } from "../../i18n";
import { DiagnosticsPanel } from "../diagnostics/DiagnosticsPanel";
import { EventsPanel } from "./EventsPanel";

export function LogDrawer({
  open,
  events,
  diagnostics,
  onClose,
}: {
  open: boolean;
  events: SteamEvent[];
  diagnostics: Diagnostics | null;
  onClose: () => void;
}) {
  const { messages: t } = useI18n();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm">
      <aside
        className="absolute right-0 top-0 grid h-full w-full max-w-[460px] grid-rows-[auto_minmax(0,1fr)] border-l border-[var(--line)] bg-[var(--bg)] shadow-[var(--modal-shadow)]"
        aria-label={t.logDrawer.aria}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t.logDrawer.title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {t.logDrawer.description}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t.logDrawer.close}
          >
            <X size={18} />
          </Button>
        </header>

        <div className="grid content-start gap-4 overflow-auto p-4">
          <EventsPanel events={events} />
          <DiagnosticsPanel diagnostics={diagnostics} />
        </div>
      </aside>
    </div>
  );
}
