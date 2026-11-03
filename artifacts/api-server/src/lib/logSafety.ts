import pino from "pino";

/**
 * Error serializer that keeps personal data out of the logs. A failed Drizzle
 * query (DrizzleQueryError) carries the SQL and every bound value — display
 * names, push tokens, leave times — in `params`, `query` and in its message
 * ("Failed query: …\nparams: …"), and the Postgres error under it can repeat
 * values in `detail` ("Key (…)=(…) already exists"). Those would sit in
 * CloudWatch for the log retention period, past the deletion times the privacy
 * policy promises. Keeps the type, code, a cut message and the stack.
 */
const DROPPED = ["params", "query", "detail", "where", "parameters", "values"];

function cutMessage(message: unknown): unknown {
  if (typeof message !== "string") return message;
  const cut = message.search(/\nparams:|\nparameters:/i);
  const head = cut === -1 ? message : message.slice(0, cut);
  // "Failed query: <SQL>" → keep only the words before the SQL.
  return head.replace(/^(Failed query):[\s\S]*$/i, "$1");
}

export function safeErr(error: unknown): unknown {
  if (!(error instanceof Error) && (typeof error !== "object" || error === null)) return error;
  const serialized = pino.stdSerializers.err(error as Error) as unknown as Record<string, unknown>;
  for (const key of DROPPED) delete serialized[key];
  serialized.message = cutMessage((error as Error).message ?? serialized.message);
  // The stack repeats the whole message (several lines for a failed query) and
  // the cause's: keep only the code locations, under the cut message.
  if (typeof serialized.stack === "string") {
    const frames = serialized.stack.split("\n").filter((line) => /^\s+at /.test(line));
    serialized.stack = [`${String(serialized.name ?? serialized.type ?? "Error")}: ${String(serialized.message)}`, ...frames].join("\n");
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) serialized.cause = safeErr(cause);
  return serialized;
}

/**
 * The same, on the error itself (the original object, rethrown so EventBridge
 * retries): bound values removed from it and its causes, the message cut.
 */
export function scrubErrorInPlace<T>(error: T): T {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    const record = current as Record<string, unknown>;
    for (const key of DROPPED) {
      if (key in record) {
        try {
          delete record[key];
        } catch {
          // a read-only property: leave it
        }
      }
    }
    if (current instanceof Error) {
      const cut = cutMessage(current.message);
      if (typeof cut === "string" && cut !== current.message) {
        const original = current.message;
        current.message = cut;
        if (current.stack) current.stack = current.stack.split(original).join(cut);
      }
    }
    current = record.cause;
  }
  return error;
}
