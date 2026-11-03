import pino from "pino";
import { safeErr } from "./logSafety";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Database errors carry bound values (names, push tokens): see lib/logSafety.
  serializers: { err: safeErr, error: safeErr },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers['x-participant-token']",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
