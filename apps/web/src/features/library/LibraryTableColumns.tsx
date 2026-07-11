import { useMemo } from "react";
import { EyeOff, Star } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "../../components/ui/button";
import { formatPlaytime } from "../../lib/format";
import { interpolate, useI18n } from "../../i18n";
import { SteamAppArtwork } from "./SteamAppArtwork";
import type { LibraryRow, LibraryUpdatePatch } from "./types";

export function useLibraryTableColumns({
  onToggleApp,
  onUpdateMeta,
}: {
  onToggleApp: (appId: number) => void;
  onUpdateMeta: (appId: number, patch: LibraryUpdatePatch) => Promise<void>;
}) {
  const { messages: t, localeInfo } = useI18n();

  return useMemo<ColumnDef<LibraryRow>[]>(
    () => [
      {
        id: "select",
        header: "",
        cell: ({ row }) => {
          const app = row.original;
          return (
            <input
              type="checkbox"
              checked={app.selected}
              disabled={app.blockedByLimit}
              title={
                app.blockedByLimit
                  ? t.library.slotLimitReached
                  : t.library.select
              }
              aria-label={interpolate(t.library.selectGame, {
                name: app.name,
              })}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleApp(app.appId)}
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "artwork",
        header: "",
        cell: ({ row }) => (
          <SteamAppArtwork
            appId={row.original.appId}
            name={row.original.name}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: t.common.game,
        cell: ({ row }) => (
          <div className="min-w-0">
            <strong className="block truncate text-sm">
              {row.original.name}
            </strong>
            <small className="text-xs text-[var(--muted)]">
              {formatPlaytime(row.original.playtimeForever, t, localeInfo)}
            </small>
          </div>
        ),
      },
      {
        accessorKey: "playtimeForever",
        header: t.common.playtime,
        cell: ({ row }) =>
          formatPlaytime(row.original.playtimeForever, t, localeInfo),
      },
      {
        accessorKey: "appId",
        header: "AppID",
        cell: ({ row }) => row.original.appId,
      },
      {
        id: "meta",
        header: "",
        cell: ({ row }) => {
          const app = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  void onUpdateMeta(app.appId, {
                    favorite: !app.favorite,
                  });
                }}
                aria-label={
                  app.favorite
                    ? interpolate(t.library.removeFromFavorites, {
                        name: app.name,
                      })
                    : interpolate(t.library.addToFavorites, { name: app.name })
                }
                title={
                  app.favorite ? t.common.removeFavorite : t.common.favorite
                }
                className={app.favorite ? "text-[var(--accent)]" : undefined}
              >
                <Star size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  void onUpdateMeta(app.appId, { hidden: !app.hidden });
                }}
                aria-label={
                  app.hidden
                    ? interpolate(t.library.showGame, { name: app.name })
                    : interpolate(t.library.hideGame, { name: app.name })
                }
                title={app.hidden ? t.common.show : t.common.hide}
                className={app.hidden ? "text-[var(--muted)]" : undefined}
              >
                <EyeOff size={14} />
              </Button>
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [localeInfo, onToggleApp, onUpdateMeta, t],
  );
}
