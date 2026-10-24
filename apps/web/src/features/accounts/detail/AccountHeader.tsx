import type { ReactNode } from "react";

export function AccountHeader({
  controls,
  status,
  profile,
}: {
  controls: ReactNode;
  status: ReactNode;
  profile: ReactNode;
}) {
  return (
    <header className="@container overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[var(--panel-shadow)]">
      <div className="grid items-start gap-4 p-4 @min-[42rem]:grid-cols-2 @min-[68rem]:grid-cols-3">
        <div className="min-w-0">{controls}</div>
        <div className="min-w-0">{status}</div>
        <div className="min-w-0 @min-[42rem]:col-span-2 @min-[68rem]:col-span-1">
          {profile}
        </div>
      </div>
    </header>
  );
}
