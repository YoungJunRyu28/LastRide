/**
 * Prevents accidentally deploying all-day five-minute DB watchdogs against
 * an unbudgeted production database. This is an owner attestation, NOT a
 * substitute for measuring Neon and EventBridge costs or setting budget alerts.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkAlertRecoveryBudget(stage, approved) {
  if (stage !== 'production' && stage !== 'staging') throw new Error('Invalid release stage');
  if (stage === 'staging') return 'Staging: alert recovery production-cost approval not needed';
  if (approved !== 'yes') throw new Error(
    'Production alert recovery is scheduled every five minutes (288 invocations/day). ' +
    'Verify actual Neon CU-hours and AWS cost, configure budget alerts, then set ' +
    'LASTRIDE_ALERT_RECOVERY_COST_APPROVED=yes. Do not approve merely to bypass this gate.',
  );
  return 'Production alert recovery cost acknowledged';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(checkAlertRecoveryBudget(process.argv[2], process.env.LASTRIDE_ALERT_RECOVERY_COST_APPROVED));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
