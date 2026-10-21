import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkAlertRecoveryBudget } from './check-alert-recovery-budget.mjs';

test('production refuses unreviewed five-minute watcher costs', () => {
  for (const value of [undefined, '', 'true', 'YES', 'no']) {
    assert.throws(() => checkAlertRecoveryBudget('production', value), /288 invocations\/day/);
  }
  assert.match(checkAlertRecoveryBudget('production', 'yes'), /acknowledged/);
});

test('staging remains available without production-cost approval', () => {
  assert.match(checkAlertRecoveryBudget('staging', undefined), /not needed/);
  assert.throws(() => checkAlertRecoveryBudget('unknown', 'yes'), /Invalid release stage/);
});

test('cost gate runs before any AWS credentials or production database mutation', () => {
  const script = readFileSync(new URL('../infra/deploy.sh', import.meta.url), 'utf8');
  const gate = script.indexOf('node scripts/check-alert-recovery-budget.mjs "$STAGE"');
  assert.ok(gate > 0, 'Alert recovery budget gate must be in deployment script');
  for (const operation of ['aws secretsmanager get-secret-value', 'pnpm --filter @workspace/db run preflight', 'sam deploy']) {
    assert.ok(script.indexOf(operation) > gate, `${operation} must follow cost approval`);
  }
});
