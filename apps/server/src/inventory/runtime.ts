import { steamManager } from "../steam/manager.js";
import { communityRequest } from "../steam/community.js";
import { InventoryMarketService } from "./service.js";
import { readMarketPriceSettings } from "./settings.js";

export const inventoryMarket = new InventoryMarketService({
  request: (accountId, path, init) => communityRequest(accountId, path, init),
  steamId: async (accountId) =>
    (await steamManager.getCommunitySession(accountId)).steamId,
  settings: readMarketPriceSettings,
  mutate: (accountId, operation) =>
    steamManager.runAccountOperation(accountId, operation),
});
export function stopAccountBatches(accountId: string) {
  inventoryMarket.stopAccountBatches(accountId);
}
export function shutdownBatches() {
  inventoryMarket.shutdownBatches();
}
