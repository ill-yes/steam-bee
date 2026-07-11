import type { AdminOverview } from "../../api";

export type AdminAccount = AdminOverview["accounts"][number];
export type AdminApp = AdminOverview["apps"][number];
export type AdminPreset = AdminOverview["presets"][number];
export type AdminSchedule = AdminOverview["schedules"][number];

export type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  action: () => Promise<boolean>;
};
