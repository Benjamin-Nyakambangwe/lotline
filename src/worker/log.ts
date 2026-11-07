import pino from "pino";

/** Structured logs. Never log connection strings, tokens, emails or bidder IDs. */
export function createLogger(level: string) {
  return pino({
    level,
    base: { svc: "worker" },
    redact: {
      paths: [
        "DATABASE_URL",
        "*.DATABASE_URL",
        "url",
        "*.url",
        "token",
        "*.token",
        "email",
        "*.email",
        "*.currentBidderId",
      ],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
