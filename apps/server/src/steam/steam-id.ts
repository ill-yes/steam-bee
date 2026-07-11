export function steamIdToString(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "getSteamID64" in value) {
    const candidate = value as { getSteamID64?: () => string };
    if (typeof candidate.getSteamID64 === "function") {
      return String(candidate.getSteamID64());
    }
  }
  return String(value);
}
