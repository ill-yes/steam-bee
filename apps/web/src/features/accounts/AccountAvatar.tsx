import { useEffect, useState } from "react";
import type { Account, SteamProfile } from "../../api";
import { api } from "../../api";
import { cn } from "../../lib/utils";

export function AccountAvatar({
  account,
  size = "md",
}: {
  account: Account;
  size?: "sm" | "md" | "lg" | "xl" | "hero";
}) {
  const [profile, setProfile] = useState<SteamProfile | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setImageFailed(false);

    void api<SteamProfile>(`/api/accounts/${account.id}/profile`)
      .then((nextProfile) => {
        if (!cancelled) setProfile(nextProfile);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const initials = account.accountName.slice(0, 2).toUpperCase();
  const avatarUrl = imageFailed ? null : profile?.avatarUrl;

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-2)] text-xs font-black text-[var(--muted-strong)]",
        size === "sm" && "h-8 w-8",
        size === "md" && "h-9 w-9",
        size === "lg" && "h-12 w-12",
        size === "xl" && "h-16 w-16",
        size === "hero" &&
          "h-[clamp(5rem,7vw,7rem)] w-[clamp(5rem,7vw,7rem)] text-base",
      )}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
