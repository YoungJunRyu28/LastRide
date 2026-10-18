import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { checkPremiumRollout } from './check-premium-rollout.mjs';

const SHA = 'a'.repeat(40);
const valid = { stage: 'production', headSha: SHA, approvedSha: SHA,
  sandboxQa: 'yes', legacyClients: 'yes', clean: true };
test('production only proceeds after all approvals for the EXACT reviewed commit', () => {
  assert.match(checkPremiumRollout(valid), /approvals checked/);
  assert.throws(() => checkPremiumRollout({...valid, approvedSha: 'b'.repeat(40)}), /exact reviewed/);
  assert.throws(() => checkPremiumRollout({...valid, approvedSha: 'abc'}), /exact reviewed/);
  assert.throws(() => checkPremiumRollout({...valid, headSha: 'bad'}), /invalid production/);
});
test('production blocks deployment without real sandbox alias/restore QA attestation', () => {
  for (const approval of [undefined, '', 'true', 'YES', 'no']) {
    assert.throws(() => checkPremiumRollout({...valid, sandboxQa: approval}), /sandbox purchase/);
  }
});
test('production blocks rollout before legacy client compatibility is approved', () => {
  for (const approval of [undefined, '', 'true', 'YES', 'no']) {
    assert.throws(() => checkPremiumRollout({...valid, legacyClients: approval}), /legacy installed-client/);
  }
});
test('production rejects dirty trees even with previously approved SHA', () => {
  assert.throws(() => checkPremiumRollout({...valid, clean: false}), /worktree must be clean/);
});
test('staging can operate without production rollout approvals or even a SHA', () => {
  assert.match(checkPremiumRollout({stage: 'staging'}), /no production migration approval/);
  assert.throws(() => checkPremiumRollout({stage: 'dev'}), /stage must be/);
});

test('deployment cannot move migration gate after AWS credentials or live DB changes', () => {
  const deploy = readFileSync(new URL('../infra/deploy.sh', import.meta.url), 'utf8');
  const gate = deploy.indexOf('node scripts/check-premium-rollout.mjs "$STAGE"');
  assert.ok(gate > 0, 'production release gate must be present');
  for (const operation of [
    'aws secretsmanager get-secret-value',
    'pnpm --filter @workspace/db run preflight',
    'pnpm --filter @workspace/db run migrate',
    'sam deploy',
  ]) {
    const index = deploy.indexOf(operation);
    assert.ok(index > gate, `${operation} must happen only after rollout approval`);
  }
});
