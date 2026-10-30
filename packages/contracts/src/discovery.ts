/** Public Steam store offers, filtered against the account's imported library. */
export type FreeGameOffer = {
  appId: number;
  name: string;
  storeUrl: string;
};

export type FreeGamesResponse = {
  offers: FreeGameOffer[];
  checkedAt: number;
  stale: boolean;
  truncated: boolean;
  libraryImportedAt: number | null;
  excludedOwnedCount: number;
  /** The public US store is used; regional availability can differ. */
  region: "US";
};
