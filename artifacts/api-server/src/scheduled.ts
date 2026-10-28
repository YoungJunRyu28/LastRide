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
 * different `task` each time. Group departure alerts, their retries and push-
 * receipt checks all run from one event-driven one-time schedule, with an
 * on-demand watchdog while alerts are pending and a sparse night backstop
 * (src/lib/leaveAlertSchedule.ts, infra/template.yaml). Nothing polls the
 * database all day, so the scale-to-zero Postgres can sleep.
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
import { scheduleNextLeaveAlert, watchdogRunning } from "./lib/leaveAlertSchedule";
import { logger } from "./lib/logger";

export type ScheduledTask = "cleanup" | "departureAlerts" | "pushReceipts";

type ScheduledEvent = {
  task: ScheduledTask;
  /** The night backstop: does nothing while the on-demand watchdog is running. */
  backstop?: boolean;
};

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
      // The backstop only matters when nothing else is watching: while the watchdog
      // runs (every 5 minutes) it checks the same things, so don't wake the database.
      if (event.backstop && (await watchdogRunning())) return;
      const [enterprise, groups] = await Promise.allSettled([
        dispatchEnterpriseDepartureAlerts(),
        dispatchGroupLeaveAlerts(),
      ]);
      // Push receipts due ~15 minutes after a send (and expired tickets) come in on
      // this same one-time schedule: no separate all-day receipt job.
      const receipts = await Promise.allSettled([reconcileGroupPushReceipts()]).then(([result]) => result);
      if (receipts.status === "fulfilled" && receipts.value.checked > 0)
        logger.info(receipts.value, "Checked group push receipts");
      if (enterprise.status === "fulfilled" && enterprise.value > 0)
        logger.info({ sent: enterprise.value }, "Sent enterprise departure alerts");
      if (groups.status === "fulfilled" && groups.value > 0)
        logger.info({ groupLeaveAlerts: groups.value }, "Sent group leave-time alerts");
      // Re-arm the one-time group schedule even if the independent Business
      // worker threw. Previously Promise.all rejection skipped this line and
      // left the group Scheduler pointing at a spent event.
      // rethrow: if the schedule can't be re-armed, fail so EventBridge retries this run.
      await scheduleNextLeaveAlert({ onlyEarlier: false, rethrow: true });
      if (groups.status === "rejected") throw groups.reason;
      if (enterprise.status === "rejected") throw enterprise.reason;
      if (receipts.status === "rejected") throw receipts.reason;
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
