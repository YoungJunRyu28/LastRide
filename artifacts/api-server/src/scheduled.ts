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
 * (production: 5 min, 1 min, 5 min; staging runs them far less often — see infra/template.yaml).
 */
import { isDatabaseConfigured } from "@workspace/db";
import {
  dispatchEnterpriseDepartureAlerts,
  reconcileEnterprisePushReceipts,
} from "./lib/enterpriseNotifications";
import { purgeExpiredCacheEntries } from "./lib/cache";
import { purgeExpiredRateLimits } from "./lib/rateLimit";
import { purgeExpiredEnterpriseData } from "./lib/enterpriseStore";
import { purgeEndedGroupNights, purgeInactiveGroupMembers } from "./lib/groupStore";
import { dispatchGroupLeaveAlerts } from "./lib/groupNotifications";
import { scheduleNextLeaveAlert } from "./lib/leaveAlertSchedule";
import { logger } from "./lib/logger";

export type ScheduledTask = "cleanup" | "departureAlerts" | "pushReceipts";

type ScheduledEvent = { task: ScheduledTask };

export async function handler(event: ScheduledEvent) {
  if (!isDatabaseConfigured()) {
    logger.warn(
      { task: event.task },
      "Skipped scheduled task: no database configured",
    );
    return;
  }

  switch (event.task) {
    case "cleanup": {
      const [eventsPurged, cacheRowsPurged, rateLimitRowsPurged, groupNightsPurged, groupMembersPurged] =
        await Promise.all([
          purgeExpiredEnterpriseData(),
          purgeExpiredCacheEntries(),
          purgeExpiredRateLimits(),
          // Deletes every group night past 08:00 JST with its leave-by rows.
          purgeEndedGroupNights(),
          // Members whose app has been gone for months (deleting the app can't tell us).
          purgeInactiveGroupMembers(),
        ]);
      if (
        eventsPurged > 0 ||
        cacheRowsPurged > 0 ||
        rateLimitRowsPurged > 0 ||
        groupNightsPurged > 0 ||
        groupMembersPurged > 0
      ) {
        logger.info(
          {
            eventsPurged,
            cacheRowsPurged,
            rateLimitRowsPurged,
            groupNightsPurged,
            groupMembersPurged,
          },
          "Purged expired application data",
        );
      }
      return;
    }
    case "departureAlerts": {
      // Group leave-time pushes ride on the same 1-minute schedule.
      const [sent, groupLeaveAlerts] = await Promise.all([
        dispatchEnterpriseDepartureAlerts(),
        dispatchGroupLeaveAlerts(),
      ]);
      if (sent > 0) logger.info({ sent }, "Sent enterprise departure alerts");
      if (groupLeaveAlerts > 0) {
        logger.info({ groupLeaveAlerts }, "Sent group leave-time alerts");
      }
      // Point the one-time schedule at the next alert due (never throws).
      await scheduleNextLeaveAlert({ onlyEarlier: false });
      return;
    }
    case "pushReceipts": {
      const result = await reconcileEnterprisePushReceipts();
      if (result.checked > 0)
        logger.info(result, "Checked enterprise push receipts");
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
