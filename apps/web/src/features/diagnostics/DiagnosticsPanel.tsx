import { Gauge } from "lucide-react";
import type { Diagnostics } from "../../api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";

export function DiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: Diagnostics | null;
}) {
  const { messages: t } = useI18n();
  const pendingMigrations = diagnostics?.migrations.pending.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Gauge size={16} />
          {t.diagnostics.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!diagnostics ? (
          <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
            {t.diagnostics.loading}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <DiagnosticItem
              label={t.diagnostics.logLevel}
              value={diagnostics.logging.level}
            />
            <DiagnosticItem
              label={t.diagnostics.requests}
              value={diagnostics.logging.requests ? t.common.on : t.common.off}
            />
            <DiagnosticItem
              label={t.diagnostics.noiseFilter}
              value={
                diagnostics.logging.quietRequests ? t.common.on : t.common.off
              }
            />
            <DiagnosticItem
              label="SSE"
              value={String(diagnostics.runtime.sseClients)}
            />
            <DiagnosticItem
              label={t.diagnostics.migration}
              value={diagnostics.migrations.current ?? t.common.none}
            />
            <DiagnosticItem
              label={t.diagnostics.pending}
              value={pendingMigrations === 0 ? "0" : String(pendingMigrations)}
              tone={pendingMigrations === 0 ? "good" : "warn"}
            />
            <DiagnosticItem
              label={t.diagnostics.events}
              value={String(diagnostics.events.sampleSize)}
            />
            <DiagnosticItem
              label={t.diagnostics.errors}
              value={String(diagnostics.events.byLevel.error ?? 0)}
              tone={
                (diagnostics.events.byLevel.error ?? 0) > 0 ? "warn" : "good"
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticItem({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <span
      className={cn(
        "grid min-h-14 min-w-0 content-center rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2",
        tone === "good" && "border-[var(--good-line)]",
        tone === "warn" && "border-[var(--warn-line)]",
      )}
    >
      <small className="truncate text-xs text-[var(--muted)]">{label}</small>
      <strong className="truncate text-sm" title={value}>
        {value}
      </strong>
    </span>
  );
}
