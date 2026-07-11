import {
  isAccountStatus,
  isDesiredState,
  isPersonaState,
  type AccountStatus,
  type SteamAccountBase,
} from "@steam-bee/contracts";
import { steamAccount } from "../db/schema.js";

type SteamAccountRow = typeof steamAccount.$inferSelect;

export function presentSteamAccount(
  account: SteamAccountRow,
  runtimeStatus: AccountStatus,
): SteamAccountBase {
  if (!isAccountStatus(account.status)) {
    throw new Error(`Unsupported persisted account status: ${account.status}`);
  }
  if (!isDesiredState(account.desiredState)) {
    throw new Error(
      `Unsupported desired account state: ${account.desiredState}`,
    );
  }
  if (!isPersonaState(account.personaState)) {
    throw new Error(`Unsupported Steam persona state: ${account.personaState}`);
  }

  return {
    id: account.id,
    accountName: account.accountName,
    steamId: account.steamId,
    status: account.status,
    runtimeStatus,
    desiredState: account.desiredState,
    personaState: account.personaState,
    customTitle: account.customTitle,
    activePresetId: account.activePresetId,
    tokenExpiresAt: account.tokenExpiresAt,
    lastError: account.lastError,
    latestBoostStartedAt: account.latestBoostStartedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
