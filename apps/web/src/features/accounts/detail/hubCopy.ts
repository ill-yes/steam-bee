import type { Messages } from "../../../i18n";

const en = {
  workspace: "Account workspace",
  library: "Boost playtime",
  farming: "Card farming",
  offers: "Free to keep",
  account: "Account & safety",
  activeGames: "Currently reported to Steam",
  activeGamesShort: "Active games",
  activeGamesScroll: "Active games; scroll horizontally for more",
  noActiveGames: "No games are currently reported to Steam.",
  logsShort: "Logs",
  stopShort: "Disconnect",
  disconnect: "Disconnect from Steam",
  activityBoosting: "Boosting playtime",
  activityFarming: "Farming cards",
  activityOnline: "Online, no game",
  switchConfirm: "Switch mode",
  confirmSwitch:
    "Stop card farming and resume playtime for your saved manual game selection? Farming will not restart automatically.",
  switchApply:
    "Card farming is active. Applying this manual selection stops farming and switches this account to manual playtime. Continue?",
  switchSettings:
    "Card farming is active. Changing these account settings stops farming and returns this account to its saved manual game selection. Continue?",
  switchPreset:
    "Card farming is active. Applying this preset stops farming and switches this account to the preset's manual game selection. Continue?",
  farmingSelectionHint:
    "Card farming is active. This is your saved manual selection. Applying it stops farming; navigating between tabs does not change the current activity.",
  savedSelection: "Saved manual games",
  savedSelectionHint:
    "Saved for manual playtime; farming uses the games shown above.",
  farmingStatusHint:
    "Card farming controls the active games shown above. Your saved manual selection stays available in Boost playtime.",
  navLabel: "Account sections",
  navActivity: "Games",
  navItems: "Items",
  navDiscover: "Discover",
  navAccount: "Account",
  inventoryNav: "Inventory",
  listings: "Market listings",
  rules: "Pricing rules",
  dropsCount: "{count} drops",
  modeLabel: "Activity reported to Steam",
  modeNone: "Nothing",
  modeNoneOnline: "Online, no game",
  modeNoneOffline: "Not connected",
  modeBoost: "Boost playtime",
  modeBoostGames: "{count} of {limit} games",
  modeBoostEmpty: "Choose games first",
  modeFarm: "Farm cards",
  modeFarmDrops: "{drops} drops in {games} games",
  modeFarmNoDrops: "No card drops found",
  modeFarmUnknown: "Card drops not checked yet",
  modeFarmUnavailable: "Open card farming to check drops",
  modeExplain:
    "Steam keeps one list of running games per account, so only one mode runs at a time. The other mode's selection stays saved.",
  confirmFarming:
    "Switch to card farming? Playtime for your {count} selected games stops; the selection stays saved. When all drops are collected, the account pauses.",
  confirmFarmingIdle:
    "Start card farming? When all drops are collected, the account pauses.",
  farmingConfirm: "Start farming",
  confirmIdle:
    "Stop reporting games to Steam? The account stays connected and paused; your selections stay saved.",
  idleConfirm: "Pause",
  reloginTitle: "Sign in again: {name}",
  reloginDescription:
    "Sign in with the same Steam account. Your selections, presets and settings stay saved.",
  reloginBannerTitle: "Steam ended the sign-in",
  reloginBannerText:
    "This happens after a password change or when the session expires. Sign in again once, then boosting, farming and the inventory work as before. Your selections stay saved.",
  reloginQr: "Sign in again (QR code)",
  reloginPassword: "With password",
  steamMessage: "Steam says: {message}",
  navAutomation: "Automation",
  sectionSelect: "Section",
  presets: "Presets",
  schedules: "Schedules",
  analytics: "Statistics",
  inventoryDescription:
    "Your Steam items grouped by game and badge set. Pick duplicates for the sell basket.",
  listingsDescription:
    "Items you currently offer on the Steam Community Market.",
  rulesDescription: "How SteamBee calculates the price when you sell.",
  accountDescription:
    "Steam profile, playtime limits and the connection state of this account.",
  stateTitle: "State",
  steamProfile: "Steam profile",
  dangerTitle: "Remove account",
  dangerText: "Deletes the sign-in and settings for this account in SteamBee.",
  lastEvent: "Last event",
  noEvents: "No events yet",
  activeGamesState: "Active games",
  boostingSince: "Boosting since",
  visibility: "Visibility",
};

export type HubCopy = typeof en;
export { en as hubEn };

/** Account hub copy; translations load with the locale's messages. */
export function hubCopy(messages: Messages): HubCopy {
  return messages.hub;
}
