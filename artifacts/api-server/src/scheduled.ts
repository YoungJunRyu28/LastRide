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
 * different `task` each time. Group departure alerts use an event-driven
 * one-time schedule plus a five-minute watchdog; receipts run independently
 * before the nightly participant-data cleanup (see infra/template.yaml).
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
import { reconcileGroupPushReceipts } from "./lib/groupAlertOutbox";
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
      const [enterprise, groups] = await Promise.allSettled([
        dispatchEnterpriseDepartureAlerts(),
        dispatchGroupLeaveAlerts(),
      ]);
      if (enterprise.status === "fulfilled" && enterprise.value > 0)
        logger.info({ sent: enterprise.value }, "Sent enterprise departure alerts");
      if (groups.status === "fulfilled" && groups.value > 0)
        logger.info({ groupLeaveAlerts: groups.value }, "Sent group leave-time alerts");
      // Re-arm the one-time group schedule even if the independent Business
      // worker threw. Previously Promise.all rejection skipped this line and
      // left the group Scheduler pointing at a spent event.
      await scheduleNextLeaveAlert({ onlyEarlier: false });
      if (groups.status === "rejected") throw groups.reason;
      if (enterprise.status === "rejected") throw enterprise.reason;
      return;
    }
    case "pushReceipts": {
      const [enterprise, group] = await Promise.allSettled([
        reconcileEnterprisePushReceipts(), reconcileGroupPushReceipts(),
      ]);
      if (enterprise.status === "fulfilled" && enterprise.value.checked > 0)
        logger.info(enterprise.value, "Checked enterprise push receipts");
      if (group.status === "fulfilled" && group.value.checked > 0)
        logger.info(group.value, "Checked group push receipts");
      // Group receipts must run even if the independent Business receipt
      // processor is down/disabled. Raise an error for Lambda retry/alarms.
      if (group.status === "rejected") throw group.reason;
      if (enterprise.status === "rejected") throw enterprise.reason;
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
