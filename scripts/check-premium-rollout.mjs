/**
 * Production subscription identity transition requires a separate, SHA-pinned
 * human release acceptance. This gate runs BEFORE Secrets Manager access,
 * live database preflight/migrations, SAM build, or Lambda deployment.
 * It does not prove acceptance itself: real sandbox QA and installed-version
 * compatibility are required inputs from a human-reviewed release record.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

/** Pure, deterministic validation to keep staging and production behavior
 * separately testable without AWS credentials or live resources. */
export function checkPremiumRollout(options) {
  const { stage, headSha, approvedSha, sandboxQa, legacyClients, clean } = options;
  if (stage !== 'production' && stage !== 'staging') {
    throw new Error('Premium rollout: stage must be staging or production');
  }
  if (stage === 'staging') return 'staging requires no production migration approval';
  if (clean !== true) throw new Error('Premium rollout: production worktree must be clean');
  if (!SHA.test(headSha || '')) throw new Error('Premium rollout: invalid production commit SHA');
  if (!SHA.test(approvedSha || '') || headSha !== approvedSha) {
    throw new Error('Premium rollout: set LASTRIDE_PREMIUM_ROLLOUT_APPROVED_SHA to the exact reviewed production HEAD SHA');
  }
  if (sandboxQa !== 'yes') {
    throw new Error('Premium rollout: real RevenueCat sandbox purchase/alias/restore QA not attested (LASTRIDE_PREMIUM_SANDBOX_QA_APPROVED=yes)');
  }
  if (legacyClients !== 'yes') {
    throw new Error('Premium rollout: legacy installed-client compatibility plan not attested (LASTRIDE_LEGACY_CLIENT_COMPATIBILITY_APPROVED=yes)');
  }
  return 'migration approvals checked against production HEAD';
}

export function checkPremiumRolloutFromEnvironment(stage, env = process.env) {
  // Don't even inspect git in staging; staging is where sandbox QA runs.
  if (stage === 'staging') return checkPremiumRollout({ stage });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const clean = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length === 0;
  return checkPremiumRollout({
    stage, headSha, clean,
    approvedSha: env.LASTRIDE_PREMIUM_ROLLOUT_APPROVED_SHA,
    sandboxQa: env.LASTRIDE_PREMIUM_SANDBOX_QA_APPROVED,
    legacyClients: env.LASTRIDE_LEGACY_CLIENT_COMPATIBILITY_APPROVED,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const stage = process.argv[2];
    console.log(checkPremiumRolloutFromEnvironment(stage));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
