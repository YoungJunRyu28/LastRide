import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkAlertRecoveryBudget } from './check-alert-recovery-budget.mjs';

const template = readFileSync(new URL('../infra/template.yaml', import.meta.url), 'utf8');

test('the deployed schedules leave the database asleep', () => {
  assert.match(checkAlertRecoveryBudget('production', template), /leave the database asleep/);
  assert.match(checkAlertRecoveryBudget('staging', template), /leave the database asleep/);
  assert.throws(() => checkAlertRecoveryBudget('unknown', template), /Invalid release stage/);
});

test('an all-day or frequent database job is refused', () => {
  const allDay = template.replace('cron(*/30 20-23,0-1 * * ? *)', 'cron(*/30 * * * ? *)');
  assert.throws(() => checkAlertRecoveryBudget('production', allDay), /all hours/);
  const frequent = template.replace('cron(*/30 20-23,0-1 * * ? *)', 'cron(*/5 20-23,0-1 * * ? *)');
  assert.throws(() => checkAlertRecoveryBudget('production', frequent), /at most every 30/);
  const receipts = template.replace('cron(10 8 * * ? *)', 'cron(*/15 * * * ? *)');
  assert.throws(() => checkAlertRecoveryBudget('production', receipts), /once a day/);
  const notBackstop = template.replace(`'{"task":"departureAlerts","backstop":true}'`, `'{"task":"departureAlerts"}'`);
  assert.throws(() => checkAlertRecoveryBudget('production', notBackstop), /backstop/);
});

test('the check runs before any AWS credentials or production database mutation', () => {
  const script = readFileSync(new URL('../infra/deploy.sh', import.meta.url), 'utf8');
  const gate = script.indexOf('node scripts/check-alert-recovery-budget.mjs "$STAGE"');
  assert.ok(gate > 0, 'Database schedule check must be in deployment script');
  for (const operation of ['aws secretsmanager get-secret-value', 'pnpm --filter @workspace/db run preflight', 'sam deploy']) {
    assert.ok(script.indexOf(operation) > gate, `${operation} must follow the check`);
  }
});
