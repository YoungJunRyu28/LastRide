import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkReceiptRetention } from './check-receipt-retention.mjs';

test('production fails closed without explicit privacy approval', () => {
  for (const value of [undefined, '', 'true', 'YES', 'no']) {
    assert.throws(() => checkReceiptRetention('production', value), /privacy\/retention approval/);
  }
  assert.match(checkReceiptRetention('production', 'yes'), /approval attested/);
});
test('staging remains available for real receipt migration testing', () => {
  assert.match(checkReceiptRetention('staging'), /Staging/);
  assert.throws(() => checkReceiptRetention('development', 'yes'), /Invalid/);
});
test('production privacy gate precedes Secrets Manager, DB migrations and SAM', () => {
  const script = readFileSync(new URL('../infra/deploy.sh', import.meta.url), 'utf8');
  const gate = script.indexOf('node scripts/check-receipt-retention.mjs "$STAGE"');
  assert.ok(gate > 0);
  for (const operation of ['aws secretsmanager get-secret-value', 'pnpm --filter @workspace/db run preflight', 'sam deploy']) {
    assert.ok(script.indexOf(operation) > gate, `${operation} must follow privacy approval`);
  }
});
