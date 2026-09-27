import app from "./app";
import { isDatabaseConfigured } from "@workspace/db";
import {
  dispatchEnterpriseDepartureAlerts,
  reconcileEnterprisePushReceipts,
} from "./lib/enterpriseNotifications";
import { purgeExpiredEnterpriseData } from "./lib/enterpriseStore";
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
      const purged = await purgeExpiredEnterpriseData();
      if (purged > 0)
        logger.info({ purged }, "Purged expired enterprise event data");
    } catch (err) {
      logger.error({ err }, "Enterprise expiry cleanup failed");
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
  const checkPushReceipts = async () => {
    try {
      const result = await reconcileEnterprisePushReceipts();
      if (result.checked > 0) {
        logger.info(result, "Checked enterprise push receipts");
      }
    } catch (err) {
      logger.error({ err }, "Enterprise push receipt worker failed");
    }
  };

  void cleanup();
  void sendDepartureAlerts();
  void checkPushReceipts();
  setInterval(cleanup, 5 * 60_000).unref();
  setInterval(sendDepartureAlerts, 60_000).unref();
  setInterval(checkPushReceipts, 5 * 60_000).unref();
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
