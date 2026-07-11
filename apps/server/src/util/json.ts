export function parseIntegerArray(value: string | null | undefined) {
  return parseArray(
    value,
    (item): item is number =>
      typeof item === "number" && Number.isInteger(item),
  );
}

export function parseStringArray(value: string | null | undefined) {
  return parseArray(value, (item): item is string => typeof item === "string");
}

export function parseJsonRecord(value: string | null | undefined) {
  const parsed = parseJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseArray<T>(
  value: string | null | undefined,
  isItem: (item: unknown) => item is T,
) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter(isItem) : [];
}

function parseJson(value: string | null | undefined) {
  try {
    return JSON.parse(value ?? "null") as unknown;
  } catch {
    return null;
  }
}
