import app from "./app";
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
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (isDatabaseConfigured()) {
  const cleanup = async () => {
    try {
      const [eventsPurged, cacheRowsPurged, rateLimitRowsPurged, groupNightsPurged, groupMembersPurged] =
        await Promise.all([
          purgeExpiredEnterpriseData(),
          purgeExpiredCacheEntries(),
          purgeExpiredRateLimits(),
          // Deletes every group night past 08:00 JST with its leave-by rows.
          purgeEndedGroupNights(),
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
    } catch (err) {
      logger.error({ err }, "Application data cleanup failed");
    }
  };
  const sendDepartureAlerts = async () => {
    try {
      const sent = await dispatchEnterpriseDepartureAlerts();
      if (sent > 0) logger.info({ sent }, "Sent enterprise departure alerts");
    } catch (err) {
      logger.error({ err }, "Enterprise departure alert worker failed");
    }
  };
  const sendGroupLeaveAlerts = async () => {
    try {
      const sent = await dispatchGroupLeaveAlerts();
      if (sent > 0) logger.info({ sent }, "Sent group leave-time alerts");
    } catch (err) {
      logger.error({ err }, "Group leave-time alert worker failed");
    }
  };
  const checkPushReceipts = async () => {
    try {
      const [result, group] = await Promise.all([
        reconcileEnterprisePushReceipts(), reconcileGroupPushReceipts(),
      ]);
      if (result.checked > 0) logger.info(result, "Checked enterprise push receipts");
      if (group.checked > 0) logger.info(group, "Checked group push receipts");
    } catch (err) {
      logger.error({ err }, "Enterprise push receipt worker failed");
    }
  };

  void cleanup();
  void sendDepartureAlerts();
  void sendGroupLeaveAlerts();
  void checkPushReceipts();
  setInterval(cleanup, 5 * 60_000).unref();
  setInterval(sendDepartureAlerts, 60_000).unref();
  setInterval(sendGroupLeaveAlerts, 60_000).unref();
  setInterval(checkPushReceipts, 5 * 60_000).unref();
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
