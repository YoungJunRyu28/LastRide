/**
 * Group leave-time alerts, event-driven: instead of checking the database every
 * minute (which keeps a scale-to-zero Postgres awake around the clock), one
 * EventBridge Scheduler one-time schedule always points at the next alert due.
 *
 * - When a member's leave time is written, the schedule moves *earlier* if the
 *   new alert is due sooner (never later, so concurrent writes can't delay one).
 * - When the schedule fires, the scheduled Lambda sends what's due and points
 *   the schedule at the next alert (or leaves it spent if there is none).
 * - A slow fallback check (infra/template.yaml) covers a missed update.
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
import { nextGroupLeaveAlertAt } from "./groupStore";
import { nextGroupOutboxRetryAt } from "./groupAlertOutbox";
import { logger } from "./logger";

type ScheduleConfig = { name: string; targetArn: string; roleArn: string };

function scheduleConfig(): ScheduleConfig | null {
  const name = process.env.LEAVE_ALERT_SCHEDULE_NAME;
  const targetArn = process.env.LEAVE_ALERT_TARGET_ARN;
  const roleArn = process.env.LEAVE_ALERT_ROLE_ARN;
  return name && targetArn && roleArn ? { name, targetArn, roleArn } : null;
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

/**
 * Points the schedule at the next leave-time alert due, if any. Never throws:
 * a scheduling problem must not fail the request that changed a leave time
 * (the fallback check still sends the alert, at most a few minutes late).
 */
export async function scheduleNextLeaveAlert({
  onlyEarlier,
  now = new Date(),
}: {
  onlyEarlier: boolean;
  now?: Date;
}): Promise<void> {
  const config = scheduleConfig();
  if (!config) return;
  try {
    const [unclaimedDue, retryDue] = await Promise.all([
      nextGroupLeaveAlertAt(now), nextGroupOutboxRetryAt(now),
    ]);
    const due = [unclaimedDue, retryDue].filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!due) return;
    const next = new Date(Math.max(due.getTime(), now.getTime() + MIN_LEAD_MS));
    next.setUTCMilliseconds(0);

    client ??= new SchedulerClient({});
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
  } catch (err) {
    logger.warn({ err }, "Could not schedule the next group leave-time alert");
  }
}
