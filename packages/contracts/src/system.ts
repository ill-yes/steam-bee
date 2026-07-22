import type { InstanceLeaseStatus } from "./operations.js";

export type BuildMetadata = {
  version: string;
  revision: string;
  buildDate: string;
};

export const SYSTEM_STATUS_CODES = {
  ready: "SYSTEM_READY",
  attention: "SYSTEM_ATTENTION_REQUIRED",
  migrationsPending: "SYSTEM_MIGRATIONS_PENDING",
} as const;

export type SystemStatusCode =
  (typeof SYSTEM_STATUS_CODES)[keyof typeof SYSTEM_STATUS_CODES];

export type MeResponse = {
  setupComplete: boolean;
  setupTokenRequired: boolean;
  authenticated: boolean;
  csrfToken: string | null;
};

export type Diagnostics = {
  build: BuildMetadata;
  logging: {
    level: string;
    requests: boolean;
    quietRequests: boolean;
  };
  runtime: {
    dataDir: string;
    publicDir: string;
    sseClients: number;
    instanceLease?: InstanceLeaseStatus;
  };
  migrations: {
    current: string | null;
    latest: string | null;
    pending: Array<{ id: string; description: string }>;
    unsupported: Array<{ id: string; description: string }>;
  };
  events: {
    sampleSize: number;
    lastEventAt: number | null;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
  };
  accounts: {
    total: number;
    desiredRunning: number;
  };
};

export type SystemStatus = {
  code: SystemStatusCode | "SYSTEM_LOADING";
  label: string;
  tone: "good" | "danger" | "warn" | "info" | "neutral";
  detail: string;
  pendingMigrations: number;
  accountErrors: number;
  recentErrors: number;
  checkedAt: number;
};
