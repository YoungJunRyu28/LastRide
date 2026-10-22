/** Two-hour minimal Expo receipt retention requires explicit owner approval. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkReceiptRetention(stage, approved) {
  if (stage !== 'production' && stage !== 'staging') throw new Error('Invalid receipt retention release stage');
  if (stage === 'staging') return 'Staging may validate bounded receipt retention';
  if (approved !== 'yes') throw new Error(
    'Group Expo receipt tickets retain opaque ticket, token digest and nullable member link for up to 2 hours ' +
    '(cleanup may lag during outages). Obtain privacy/retention approval before setting ' +
    'LASTRIDE_GROUP_RECEIPT_RETENTION_APPROVED=yes. Never approve merely to bypass this gate.',
  );
  return 'Privacy/receipt-retention approval attested';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(checkReceiptRetention(process.argv[2], process.env.LASTRIDE_GROUP_RECEIPT_RETENTION_APPROVED));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
