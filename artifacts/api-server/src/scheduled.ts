/**
 * Runs the three periodic enterprise jobs on Lambda, in place of the
 * `setInterval` loop in index.ts.
 *
 * That loop is correct for an always-on host (local dev, a Docker container)
 * but does not translate to Lambda: a Lambda instance is not guaranteed to
 * keep running between invocations, so a timer registered inside one
 * invocation may simply never fire again. The jobs themselves — purge
 * expired event data, send departure alerts, reconcile push receipts — are
 * unchanged; only how they get invoked changes, from an in-process timer to
 * three separate EventBridge Scheduler rules calling this Lambda with a
 * different `task` each time, at the same rates the original loop used
 * (5 min, 1 min, 5 min — see deploy-lambda.sh).
 */
import { isDatabaseConfigured } from "@workspace/db";
import {
  dispatchEnterpriseDepartureAlerts,
  reconcileEnterprisePushReceipts,
} from "./lib/enterpriseNotifications";
import { purgeExpiredCacheEntries } from "./lib/cache";
import { purgeExpiredRateLimits } from "./lib/rateLimit";
import { purgeExpiredEnterpriseData } from "./lib/enterpriseStore";
import { logger } from "./lib/logger";

export type ScheduledTask = "cleanup" | "departureAlerts" | "pushReceipts";

type ScheduledEvent = { task: ScheduledTask };

export async function handler(event: ScheduledEvent) {
  if (!isDatabaseConfigured()) {
    logger.warn({ task: event.task }, "Skipped scheduled task: no database configured");
    return;
  }

  switch (event.task) {
    case "cleanup": {
      const [eventsPurged, cacheRowsPurged, rateLimitRowsPurged] =
        await Promise.all([
          purgeExpiredEnterpriseData(),
          purgeExpiredCacheEntries(),
          purgeExpiredRateLimits(),
        ]);
      if (eventsPurged > 0 || cacheRowsPurged > 0 || rateLimitRowsPurged > 0) {
        logger.info(
          { eventsPurged, cacheRowsPurged, rateLimitRowsPurged },
          "Purged expired application data",
        );
      }
      return;
    }
    case "departureAlerts": {
      const sent = await dispatchEnterpriseDepartureAlerts();
      if (sent > 0) logger.info({ sent }, "Sent enterprise departure alerts");
      return;
    }
    case "pushReceipts": {
      const result = await reconcileEnterprisePushReceipts();
      if (result.checked > 0) logger.info(result, "Checked enterprise push receipts");
      return;
    }
    default: {
      // Exhaustiveness check: if a new ScheduledTask is ever added without a
      // matching case above, this fails to compile rather than silently
      // doing nothing when EventBridge invokes it.
      const _never: never = event.task;
      throw new Error(`Unknown scheduled task: ${_never}`);
    }
  }
}
