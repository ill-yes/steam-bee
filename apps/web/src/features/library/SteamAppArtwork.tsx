import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "../../lib/utils";

export function SteamAppArtwork({
  appId,
  name,
  size = "row",
}: {
  appId: number;
  name: string;
  size?: "row" | "mini" | "large";
}) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidates = steamArtworkCandidates(appId);
  const src = candidates[candidateIndex];

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-2)]",
        size === "mini" && "h-8 w-14",
        size === "row" && "h-12 w-[92px]",
        size === "large" && "aspect-[460/215] w-full",
      )}
      title={name}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setCandidateIndex((index) => index + 1)}
        />
      ) : (
        <ImageOff size={size === "mini" ? 14 : 18} aria-hidden="true" />
      )}
    </span>
  );
}

function steamArtworkCandidates(appId: number) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return [
    `${base}/header.jpg`,
    `${base}/capsule_616x353.jpg`,
    `${base}/capsule_184x69.jpg`,
  ];
}
