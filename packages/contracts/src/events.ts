export type SteamEvent = {
  id: number;
  accountId: string | null;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};
