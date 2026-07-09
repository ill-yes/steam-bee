const SECRET_KEYS = [
  "password",
  "token",
  "refreshToken",
  "accessToken",
  "cookie",
  "guard",
  "code",
  "auth",
  "secret",
];

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      result[key] = SECRET_KEYS.some((secretKey) =>
        lowerKey.includes(secretKey),
      )
        ? "[redacted]"
        : redact(nestedValue);
    }
    return result;
  }

  if (typeof value === "string" && value.length > 80 && value.includes(".")) {
    return "[redacted]";
  }

  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(
      /[A-Za-z0-9-_]{24,}\.[A-Za-z0-9-_]+/g,
      "[redacted]",
    );
  }

  return "Unknown error";
}
