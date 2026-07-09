import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import type { SteamEvent } from "../../api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { formatEventDate, formatEventTime } from "../../lib/format";
import {
  eventDisplay,
  eventFilterModes,
  eventMatchesFilter,
  type EventFilterMode,
} from "../../lib/status";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

export function EventsPanel({ events }: { events: SteamEvent[] }) {
  const { messages: t, localeInfo } = useI18n();
  const [eventFilter, setEventFilter] = useState<EventFilterMode>("all");
  const filteredEvents = useMemo(
    () => events.filter((event) => eventMatchesFilter(event, eventFilter)),
    [events, eventFilter],
  );

  return (
    <Card>
      <CardHeader className="items-center">
        <CardTitle>
          <ListChecks size={16} />
          {t.common.events}
        </CardTitle>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-xs font-semibold text-[var(--muted-strong)]">
          {filteredEvents.length}/{events.length}
        </span>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SegmentedControl
          value={eventFilter}
          onChange={setEventFilter}
          ariaLabel={t.eventsPanel.filterAria}
          className="w-full overflow-auto"
          options={eventFilterModes(t)}
        />
        <div className="grid max-h-[440px] gap-2 overflow-auto pr-1">
          {filteredEvents.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
              {events.length === 0
                ? t.eventsPanel.noLogs
                : t.eventsPanel.noFilterLogs}
            </div>
          ) : (
            filteredEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                messages={t}
                localeInfo={localeInfo}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  messages,
  localeInfo,
}: {
  event: SteamEvent;
  messages: ReturnType<typeof useI18n>["messages"];
  localeInfo: ReturnType<typeof useI18n>["localeInfo"];
}) {
  const display = eventDisplay(event, messages);
  const occurredAt = new Date(event.createdAt);

  return (
    <div
      className={cn(
        "grid grid-cols-[58px_minmax(0,1fr)] gap-3 rounded-md border bg-[var(--surface-2)] p-3",
        event.level === "error"
          ? "border-[var(--danger-line)]"
          : event.level === "warn"
            ? "border-[var(--warn-line)]"
            : "border-[var(--line)]",
      )}
    >
      <time
        dateTime={occurredAt.toISOString()}
        className="grid content-start gap-0.5 text-xs"
      >
        <span className="text-[var(--muted)]">
          {formatEventDate(event.createdAt, localeInfo)}
        </span>
        <strong>{formatEventTime(event.createdAt, localeInfo)}</strong>
      </time>
      <span className="min-w-0">
        <strong className="block truncate text-sm">{display.title}</strong>
        {display.body ? (
          <small className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
            {display.body}
          </small>
        ) : null}
      </span>
    </div>
  );
}
