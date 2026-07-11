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
    <header className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[var(--panel-shadow)]">
      <div className="grid gap-4 p-4 xl:grid-cols-[380px_minmax(0,1fr)_360px] xl:items-stretch">
        {controls}
        {status}
        {profile}
      </div>
    </header>
  );
}
