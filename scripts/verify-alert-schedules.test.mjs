import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('../infra/template.yaml', import.meta.url), 'utf8');
const groupStore = readFileSync(new URL('../artifacts/api-server/src/lib/groupStore.ts', import.meta.url), 'utf8');

function scheduleSection(name, following) {
  const pattern = new RegExp(`^        ${name}:\\n([\\s\\S]*?)(?=^[ ]{2,8}${following}:)`, 'm');
  const match = template.match(pattern);
  assert.ok(match, `Expected dedicated ${name} ScheduleV2 block`);
  return match[1];
}
function cron(section) {
  const match = section.match(/ScheduleExpression: "cron\(([^)]+)\)"/);
  assert.ok(match, 'Expected EventBridge cron expression');
  return match[1].split(/\s+/);
}
function assertTask(section, task) {
  assert.match(section, /Type: ScheduleV2/);
  assert.ok(section.includes(`Input: '{"task":"${task}"}'`), `Schedule must dispatch ${task}`);
  assert.match(section, /FlexibleTimeWindow:\s*\n\s*Mode: "OFF"/);
  assert.match(section, /QueueLogicalId: \w+ScheduleDlq/);
}

const scheduler = readFileSync(new URL('../artifacts/api-server/src/lib/leaveAlertSchedule.ts', import.meta.url), 'utf8');
const scheduled = readFileSync(new URL('../artifacts/api-server/src/scheduled.ts', import.meta.url), 'utf8');

test('a missed group alert is caught within its 10-minute window, without polling all day', () => {
  // While alerts are pending, the on-demand watchdog checks at least twice per window.
  const graceMinutes = Number(groupStore.match(/GROUP_LEAVE_ALERT_GRACE_MS = (\d+) \* 60_000/)?.[1]);
  assert.ok(Number.isInteger(graceMinutes));
  const rate = Number(scheduler.match(/WATCHDOG_RATE = "rate\((\d+) minutes\)"/)?.[1]);
  assert.ok(Number.isInteger(rate) && rate <= graceMinutes / 2,
    `Watchdog every ${rate} minutes must allow margin before ${graceMinutes}-minute alert expiry`);
  assert.match(scheduler, /WATCHDOG_TAIL_MS = GROUP_LEAVE_ALERT_GRACE_MS \+/, 'Watchdog runs past the last alert window');
  // The fixed schedule is a sparse night backstop that skips the database while the watchdog runs.
  const backstop = scheduleSection('DepartureAlerts', 'PushReceipts');
  assert.match(backstop, /Type: ScheduleV2/);
  assert.ok(backstop.includes(`Input: '{"task":"departureAlerts","backstop":true}'`));
  assert.match(backstop, /FlexibleTimeWindow:\s*\n\s*Mode: "OFF"/);
  assert.deepEqual(cron(backstop), ['*/30', '20-23,0-1', '*', '*', '?', '*']);
  assert.match(scheduled, /event\.backstop && \(await watchdogRunning\(\)\)/);
  assert.match(template, /LEAVE_ALERT_WATCHDOG_NAME: !Sub "lastride-\$\{Stage\}-leave-alert-watchdog"/);
});

test('Expo group receipts are checked when due from the one-time schedule, plus a daily backstop', () => {
  assert.match(scheduler, /nextGroupReceiptWorkAt\(now, tx\)/, 'Receipt checks and expiry wake the one-time schedule');
  assert.match(scheduled, /reconcileGroupPushReceipts\(\)/);
  const receipts = scheduleSection('PushReceipts', 'ApiErrorsAlarm');
  const cleanup = scheduleSection('Cleanup', 'DepartureAlerts');
  assertTask(receipts, 'pushReceipts');
  assert.match(receipts, /State: ENABLED/);
  assert.doesNotMatch(receipts, /State: !If \[BusinessEnabled/);
  assert.deepEqual(cron(receipts), ['10', '8', '*', '*', '?', '*']);
  assert.deepEqual(cron(cleanup), ['5', '8', '*', '*', '?', '*']);
});

test('each scheduled fallback has a unique SQS DLQ and retries enabled', () => {
  const names = ['Cleanup', 'DepartureAlerts', 'PushReceipts'];
  const following = ['DepartureAlerts', 'PushReceipts', 'ApiErrorsAlarm'];
  const queues = names.map((name, index) => {
    const section = scheduleSection(name, following[index]);
    const id = section.match(/QueueLogicalId: (\w+ScheduleDlq)/)?.[1];
    assert.ok(id, `${name} must have a DLQ`);
    assert.match(section, /MaximumRetryAttempts: 3/);
    return id;
  });
  assert.equal(new Set(queues).size, names.length, 'SAM ScheduleV2 DLQ logical names must be unique');
});

test('the primary one-time event is still configured and retryable, not replaced by a cron-only workaround', () => {
  const source = readFileSync(new URL('../artifacts/api-server/src/lib/leaveAlertSchedule.ts', import.meta.url), 'utf8');
  assert.match(source, /new CreateScheduleCommand\(input\)/);
  assert.match(source, /new UpdateScheduleCommand\(input\)/);
  assert.match(source, /MaximumRetryAttempts: 3/);
  assert.match(source, /withLeaveScheduleLock/);
});
