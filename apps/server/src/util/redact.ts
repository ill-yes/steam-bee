const redactedValue = "[redacted]";
const secretKeyFragments = [
  "password",
  "passwd",
  "pwd",
  "token",
  "cookie",
  "guardcode",
  "authorization",
  "secret",
  "jwt",
  "credential",
  "apikey",
  "privatekey",
  "sessionid",
];

const bearerTokenPattern = /\b(Bearer)\s+[^\s,;]+/gi;
const jwtPattern =
  /(^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,2})(?=$|[^A-Za-z0-9_-])/g;
const dottedSecretPattern =
  /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]+)(?=$|[^A-Za-z0-9_-])/g;
const sensitiveAssignmentPattern =
  /(\b(?:password|passwd|pwd|(?:(?:access|refresh|id|setup|csrf|session|guard)[_-]?)?token|secret|jwt|client[_-]?secret|api[_-]?key|private[_-]?key|credential|authorization|auth|cookie|steam[_-]?guard[_-]?code|guard[_-]?code)\b\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:(?:Bearer|Basic)\s+)?[^\s,;&]+)/gi;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      result[key] = secretKeyFragments.some((fragment) =>
        normalizedKey.includes(fragment),
      )
        ? redactedValue
        : redact(nestedValue);
    }
    return result;
  }

  if (typeof value === "string") return redactText(value);

  return value;
}

export function redactText(value: string): string {
  return value
    .replace(bearerTokenPattern, `$1 ${redactedValue}`)
    .replace(
      jwtPattern,
      (_match, prefix: string) => `${prefix}${redactedValue}`,
    )
    .replace(
      dottedSecretPattern,
      (_match, prefix: string) => `${prefix}${redactedValue}`,
    )
    .replace(
      sensitiveAssignmentPattern,
      (_match, prefix: string) => `${prefix}${redactedValue}`,
    );
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactText(error.message);
  }

  return "Unknown error";
}
