/**
 * Group leave-time alerts, event-driven: instead of checking the database every
 * minute (which keeps a scale-to-zero Postgres awake around the clock), one
 * EventBridge Scheduler one-time schedule always points at the next alert due.
 *
 * - When a member's leave time is written, the schedule moves *earlier* if the
 *   new alert is due sooner (never later, so concurrent writes can't delay one).
 * - When the schedule fires, the scheduled Lambda sends what's due and points
 *   the schedule at the next alert (or leaves it spent if there is none).
 * - The same schedule wakes for group push-receipt checks (~15 minutes after a
 *   push) and each receipt ticket's 2-hour expiry: no all-day receipt polling.
 * - While alerts are pending, a recurring watchdog (every 5 minutes, inside the
 *   10-minute alert window) covers a missed update, and ends 15 minutes after
 *   the last one. Nights without groups have none, so the database can sleep.
 * - A sparse night backstop (infra/template.yaml) covers a write lost before
 *   any of this was set, and skips the database while the watchdog runs.
 *
 * Without the LEAVE_ALERT_* environment (local development) this does nothing:
 * the in-process timer in index.ts sends alerts there.
 */
import {
  CreateScheduleCommand,
  GetScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { GROUP_LEAVE_ALERT_GRACE_MS, lastGroupLeaveAlertAt, nextGroupLeaveAlertAt } from "./groupStore";
import { nextGroupOutboxRetryAt, nextGroupReceiptWorkAt } from "./groupAlertOutbox";
import { getDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

type ScheduleConfig = { name: string; targetArn: string; roleArn: string; watchdogName: string | null };

function scheduleConfig(): ScheduleConfig | null {
  const name = process.env.LEAVE_ALERT_SCHEDULE_NAME;
  const targetArn = process.env.LEAVE_ALERT_TARGET_ARN;
  const roleArn = process.env.LEAVE_ALERT_ROLE_ARN;
  const watchdogName = process.env.LEAVE_ALERT_WATCHDOG_NAME || null;
  return name && targetArn && roleArn ? { name, targetArn, roleArn, watchdogName } : null;
}

/** Inside the 10-minute alert window with room to spare (one missed run still leaves one). */
export const WATCHDOG_RATE = "rate(5 minutes)";
/** The watchdog keeps going this long after the last pending alert (its window, plus a margin). */
export const WATCHDOG_TAIL_MS = GROUP_LEAVE_ALERT_GRACE_MS + 5 * 60_000;

/**
 * Until when the watchdog should run: just past the last pending alert, or
 * null when none is pending. Never shortens an end already set further out.
 */
export function watchdogUntil(lastAlert: Date | null, currentEnd: Date | null, now: Date): Date | null {
  if (!lastAlert) return null;
  const end = new Date(Math.max(lastAlert.getTime() + WATCHDOG_TAIL_MS, now.getTime() + WATCHDOG_TAIL_MS));
  end.setUTCMilliseconds(0);
  return currentEnd && currentEnd.getTime() >= end.getTime() ? null : end;
}

/** Fire no sooner than this from now: a time already due is handled right away. */
const MIN_LEAD_MS = 20_000;

/** EventBridge Scheduler's one-time form, in UTC to the second: at(2026-10-14T13:31:00). */
export function atExpression(date: Date): string {
  return `at(${date.toISOString().slice(0, 19)})`;
}

/** The time in an at(...) expression (UTC), or null for any other expression. */
export function parseAtExpression(expression: string | undefined): Date | null {
  const match = expression?.match(/^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/);
  return match ? new Date(`${match[1]}Z`) : null;
}

/**
 * Whether the schedule should change from `current` to `next`. `onlyEarlier`
 * (writes of leave times) keeps a pending schedule that's due sooner; the
 * scheduled run itself always moves on to the next alert.
 */
export function shouldMoveSchedule(
  current: Date | null,
  next: Date,
  now: Date,
  onlyEarlier: boolean,
): boolean {
  const pending = current !== null && current.getTime() > now.getTime();
  if (!pending) return true;
  if (current.getTime() === next.getTime()) return false;
  return onlyEarlier ? next.getTime() < current.getTime() : true;
}

let client: SchedulerClient | null = null;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Serialize external EventBridge mutations across independent Lambda instances. */
export async function withLeaveScheduleLock<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(472281, 7310)`);
    return work(tx);
  });
}

/**
 * Points the schedule at the next leave-time alert due, if any. Never throws:
 * a scheduling problem must not fail the request that changed a leave time
 * (the fallback check still sends the alert, at most a few minutes late).
 */
export async function scheduleNextLeaveAlert({
  onlyEarlier,
  now = new Date(),
  rethrow = false,
}: {
  onlyEarlier: boolean;
  now?: Date;
  /** The scheduled run: fail loudly, so EventBridge retries the run instead of the chain stopping. */
  rethrow?: boolean;
}): Promise<void> {
  const config = scheduleConfig();
  if (!config) return;
  // A watchdog problem mustn't stop the one-time schedule being set: noted, raised after.
  let watchdogError: unknown = null;
  try {
    // The advisory transaction lock serializes schedule read/modify/write
    // across containers and Lambda instances. Query via the SAME transaction
    // connection to avoid deadlocking a small serverless connection pool.
    await withLeaveScheduleLock(async (tx) => {
      const [unclaimedDue, retryDue, receiptDue, lastAlert] = await Promise.all([
        nextGroupLeaveAlertAt(now, tx), nextGroupOutboxRetryAt(now, tx),
        nextGroupReceiptWorkAt(now, tx), lastGroupLeaveAlertAt(now, tx),
      ]);
      client ??= new SchedulerClient({});
      if (config.watchdogName) {
        await ensureWatchdog(client, config, lastAlert, now).catch((err: unknown) => {
          watchdogError = err;
        });
      }
      const due = [unclaimedDue, retryDue, receiptDue].filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (!due) return;
      const next = new Date(Math.max(due.getTime(), now.getTime() + MIN_LEAD_MS));
      next.setUTCMilliseconds(0);

      let current: Date | null = null;
      let exists = true;
      try {
        const schedule = await client.send(new GetScheduleCommand({ Name: config.name }));
        current = parseAtExpression(schedule.ScheduleExpression);
      } catch (err) {
        if (!(err instanceof ResourceNotFoundException)) throw err;
        exists = false;
      }
      if (!shouldMoveSchedule(current, next, now, onlyEarlier)) return;

      const input = {
        Name: config.name,
        ScheduleExpression: atExpression(next),
        ScheduleExpressionTimezone: "UTC",
        FlexibleTimeWindow: { Mode: "OFF" as const },
        // Kept after it runs (not deleted), so the next update reuses it.
        ActionAfterCompletion: "NONE" as const,
        Target: {
          Arn: config.targetArn,
          RoleArn: config.roleArn,
          Input: JSON.stringify({ task: "departureAlerts" }),
          RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 300 },
        },
      };
      await client.send(exists ? new UpdateScheduleCommand(input) : new CreateScheduleCommand(input));
    });
  } catch (err) {
    logger.warn({ err }, "Could not schedule the next group leave-time alert");
    if (rethrow) throw err;
  }
  if (watchdogError) {
    logger.warn({ err: watchdogError }, "Could not start the group alert watchdog");
    if (rethrow) throw watchdogError;
  }
}

/** Starts or extends the recurring watchdog while leave alerts are pending. */
async function ensureWatchdog(client: SchedulerClient, config: ScheduleConfig, lastAlert: Date | null, now: Date): Promise<void> {
  if (!config.watchdogName || !lastAlert) return;
  let currentEnd: Date | null = null;
  let exists = true;
  try {
    const schedule = await client.send(new GetScheduleCommand({ Name: config.watchdogName }));
    currentEnd = schedule.State === "ENABLED" && schedule.EndDate ? new Date(schedule.EndDate) : null;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    exists = false;
  }
  const until = watchdogUntil(lastAlert, currentEnd && currentEnd > now ? currentEnd : null, now);
  if (!until) return;
  const input = {
    Name: config.watchdogName,
    ScheduleExpression: WATCHDOG_RATE,
    EndDate: until,
    State: "ENABLED" as const,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    // Kept once it ends (not deleted), so the next night's first alert reuses it.
    ActionAfterCompletion: "NONE" as const,
    Target: {
      Arn: config.targetArn,
      RoleArn: config.roleArn,
      Input: JSON.stringify({ task: "departureAlerts" }),
      RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 300 },
    },
  };
  await client.send(exists ? new UpdateScheduleCommand(input) : new CreateScheduleCommand(input));
}

/**
 * For the night backstop: whether the watchdog is running now. If so it already
 * checks every 5 minutes, and the backstop needn't wake the database. An AWS
 * call only; unknown counts as not running (the backstop then checks itself).
 */
export async function watchdogRunning(now = new Date()): Promise<boolean> {
  const config = scheduleConfig();
  if (!config?.watchdogName) return false;
  try {
    client ??= new SchedulerClient({});
    const schedule = await client.send(new GetScheduleCommand({ Name: config.watchdogName }));
    return schedule.State === "ENABLED" && !!schedule.EndDate && new Date(schedule.EndDate) > now;
  } catch {
    return false;
  }
}
