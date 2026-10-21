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

test('backup group alert scan is within the 10-minute expiration window and covers all JST hours', () => {
  const fallback = scheduleSection('DepartureAlerts', 'PushReceipts');
  assertTask(fallback, 'departureAlerts');
  const [minutes, hours, day, month, weekday, year] = cron(fallback);
  assert.equal(hours, '*', 'No night-only gaps: participants may leave between 04:00 and 08:00 JST');
  assert.equal(day, '*');
  assert.equal(month, '*');
  assert.equal(weekday, '?');
  assert.equal(year, '*');
  const step = Number(minutes.match(/^\*\/(\d+)$/)?.[1]);
  assert.ok(Number.isInteger(step) && step > 0 && 60 % step === 0, 'Continuous valid minute interval');
  const graceMinutes = Number(groupStore.match(/GROUP_LEAVE_ALERT_GRACE_MS = (\d+) \* 60_000/)?.[1]);
  assert.ok(Number.isInteger(graceMinutes));
  assert.ok(step <= graceMinutes / 2,
    `Fallback ${step} minutes must allow sufficient margin before ${graceMinutes}-minute alert expiry`);
});

test('Expo group push receipts run without Business enabled and before nightly privacy cleanup', () => {
  const receipts = scheduleSection('PushReceipts', 'PushReceiptsFinal');
  const final = scheduleSection('PushReceiptsFinal', 'ApiErrorsAlarm');
  const cleanup = scheduleSection('Cleanup', 'DepartureAlerts');
  assertTask(receipts, 'pushReceipts');
  assertTask(final, 'pushReceipts');
  assert.match(receipts, /State: ENABLED/);
  assert.doesNotMatch(receipts, /State: !If \[BusinessEnabled/);
  assert.deepEqual(cron(receipts), ['*/15', '18-23,0-7', '*', '*', '?', '*']);
  assert.deepEqual(cron(final), ['0', '8', '*', '*', '?', '*']);
  assert.deepEqual(cron(cleanup), ['5', '8', '*', '*', '?', '*']);
});

test('each scheduled fallback has a unique SQS DLQ and retries enabled', () => {
  const names = ['Cleanup', 'DepartureAlerts', 'PushReceipts', 'PushReceiptsFinal'];
  const following = ['DepartureAlerts', 'PushReceipts', 'PushReceiptsFinal', 'ApiErrorsAlarm'];
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
