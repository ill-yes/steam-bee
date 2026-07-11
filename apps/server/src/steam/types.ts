import type { AccountStatus as ContractAccountStatus } from "@steam-bee/contracts";

export {
  ACCOUNT_STATUSES as accountStatuses,
  PERSONA_STATES as personaStates,
  type AccountStatus,
  type DesiredState,
  type PersonaState,
} from "@steam-bee/contracts";

export type OwnedApp = {
  appId: number;
  name: string;
  playtimeForever: number;
};

export type WorkerStatusPayload = {
  accountId: string;
  status: ContractAccountStatus;
  error?: string;
};
