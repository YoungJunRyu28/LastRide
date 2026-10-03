# LastRide infrastructure

LastRide's AWS deployment is defined by `infra/template.yaml` using AWS SAM.
Do not create or update the production Lambda, API Gateway, scheduler, IAM roles,
alarms, or queues manually.

## Environments

Use separate CloudFormation stacks and separate Secrets Manager secrets:

- `lastride-staging`
- `lastride-production`

The deployment script defaults to `ap-northeast-1`; override `AWS_REGION`
explicitly when required.

## Required tooling

Install and authenticate:

- Node 24 and pnpm 10.34.6
- AWS CLI v2
- AWS SAM CLI
- Docker, when required by SAM on the local platform

The AWS principal running the deployment must be allowed to deploy the SAM
stack, read the selected Secrets Manager secret, manage the stack's IAM roles,
and perform the CodeDeploy/Lambda/API Gateway/Scheduler/CloudWatch/SNS/SQS
operations represented by the template.

## Secret contract

Create one JSON secret per environment. It must contain non-empty values for:

```json
{
  "DATABASE_URL": "...",
  "RAPIDAPI_KEY": "...",
  "EKISPERT_KEY": "...",
  "SUPABASE_URL": "...",
  "SUPABASE_ANON_KEY": "...",
  "USAGE_ADMIN_TOKEN": "...",
  "EXPO_ACCESS_TOKEN": "..."
}
```

Use the pooled production database URL for serverless execution. Enable Expo
Push Security for the production EAS project and store its access token as
`EXPO_ACCESS_TOKEN`. Never commit these values or put the secret JSON in a
shell history entry.

The SAM template uses Secrets Manager dynamic references. CloudFormation
resolves those references into the Lambda environment during deployment; if a
secret value is rotated, perform a deployment so the Lambda configuration is
updated.

## Deploy staging

```bash
export AWS_REGION=ap-northeast-1
export CORS_ALLOWED_ORIGINS=https://staging.example.com
./infra/deploy.sh staging last-ride/staging
```

The script performs non-mutating repository validation, runs the migration
data preflight (`pnpm --filter @workspace/db run preflight`, which aborts the
deployment before anything is migrated if existing data would break a
migration), runs the committed database migrations, validates/builds the SAM application, deploys the stack,
and smoke tests both liveness and readiness. Database-backed integration tests
run in CI against disposable Postgres; the deployment script never points the
test suite at staging or production data.

## Deploy production

Set provider quotas to the limits in the actual commercial contracts rather
than assuming the safety defaults:

```bash
export AWS_REGION=ap-northeast-1
export CORS_ALLOWED_ORIGINS=https://app.example.com
export ALARM_EMAIL=operations@example.com
export EKISPERT_MONTHLY_LIMIT=...
export NAVITIME_TRANSPORT_MONTHLY_LIMIT=...
export NAVITIME_ROUTE_WALK_MONTHLY_LIMIT=...
export NAVITIME_ROUTE_CAR_MONTHLY_LIMIT=...
export NAVITIME_SPOT_MONTHLY_LIMIT=...
export NAVITIME_GEOCODING_MONTHLY_LIMIT=...

git checkout main && git pull --ff-only origin main
./infra/deploy.sh production last-ride/production --confirm
```

Production deliberately refuses to run unless `--confirm` is passed, the
working tree is clean (`git status --porcelain` is empty), and `HEAD` equals
`origin/main` after a `git fetch`. Production only ships merged, reviewed
code. Staging has none of these guards.

The first production stack creation deploys without traffic shifting because
there is no previous `live` alias version. Later production deployments enable
a 10%/5-minute canary through CodeDeploy. CloudWatch errors participate in the
deployment decision, and the post-traffic hook calls `/api/readyz`.

## Cut-over from the legacy deployment

Before this stack existed, production ran on resources created by hand by the
retired `artifacts/api-server/scripts/deploy-lambda.sh` (`lastride-api`,
`lastride-api-scheduled`, the `lastride-api` HTTP API, three
`lastride-*` schedules and two IAM roles). The SAM stack uses different
names, so those keep running until removed: both sets of schedules hit the
production database and paid-provider quotas, and the old functions hold
production secrets in plaintext environment variables. Do the cut-over in
this order:

1. **Deploy the new production stack:**
   `./infra/deploy.sh production last-ride/production --confirm`.
2. **Repoint the app.** Set the mobile build's `EXPO_PUBLIC_API_URL` to the
   stack's `ApiUrl` output, ship that build, and verify `/api/healthz`,
   `/api/readyz` and the main flows against the new URL.
3. **Remove the legacy deployment.** Review the dry run, then delete:

   ```bash
   ./infra/decommission-legacy.sh            # dry run: prints what it would do
   ./infra/decommission-legacy.sh --confirm  # deletes
   ```

   It deletes the schedules first (stopping the duplicate jobs), then the
   functions, then the HTTP API, then the IAM roles (detaching/deleting their
   policies), and sets 30-day retention on the old `/aws/lambda/lastride-api*`
   log groups. It is idempotent, never prints function configuration, and
   with `--confirm` refuses to run until `lastride-production` is deployed.
4. **Rotate every secret that was in the old `.env.production`**: the
   database password (`DATABASE_URL`), `RAPIDAPI_KEY`, `EKISPERT_KEY`, and the
   Supabase keys. They sat in plaintext Lambda configuration, so treat them as
   exposed. Update the `last-ride/production` secret in Secrets Manager with the
   new values (and revoke the old ones at each provider).
5. **Redeploy** so Lambda picks up the rotated values:
   `./infra/deploy.sh production last-ride/production --confirm`.

## Database migration rule

Migrations run before application traffic changes. Therefore production
migrations must be backward compatible with the currently running application:

1. add new columns/tables/indexes first;
2. deploy code that can use the new schema;
3. backfill data separately when necessary;
4. remove old schema only in a later release after no running version depends
   on it.

Never replace the migration step with `drizzle-kit push`.

## Alarms and scheduled jobs

The stack provisions alarms for API errors, API throttles, and scheduled-worker
errors. They fire on sustained problems, not a single failed provider call:
API errors/throttles at 5 or more per minute for 2 consecutive minutes, and
scheduled-worker errors at 3 or more per 5 minutes for 2 consecutive periods.
The API errors alarm also gates canary deployments. They publish to the environment's operations SNS topic. Supplying
`ALARM_EMAIL` creates an email subscription that still has to be confirmed by
the recipient.

Job rates depend on the stage. Production: cleanup and push receipts every
5 minutes, departure alerts every minute. Staging: departure alerts every
15 minutes, cleanup and push receipts every 30 minutes, so a scale-to-zero
staging database can suspend between runs.

Every function writes to a stack-managed `/aws/lambda/<FunctionName>` log
group with 30-day retention.

Each EventBridge Scheduler job has bounded retries and an SQS dead-letter
queue generated by SAM. Investigate any DLQ message before redriving it.

## Rollback

CodeDeploy performs automatic rollback for a failed canary. For an emergency
manual rollback of Lambda aliases:

```bash
./infra/rollback.sh production
```

That script moves the API and scheduled-worker `live` aliases to their
previous published versions. This is an emergency action: afterwards reconcile
the CloudFormation stack before the next deployment.

Database migrations are not automatically reversed. This is why migrations
must follow the backward-compatible rule above.

## Release gates

Do not deploy production unless all of these are true:

- CI is green from a clean database migrated only with committed migrations.
- The selected secret passes the deployment script's required-key check.
- `/api/readyz` succeeds against staging.
- Provider quotas match the purchased plans and expected traffic.
- Production CORS origins are explicitly configured.
- Organizer authentication and push have been tested on physical devices.
- Background location has been tested on physical iOS and Android devices.
- The mobile production build has a real `EXPO_PUBLIC_API_URL`.
- EAS/APNs/FCM credentials and universal/app-link domain files are configured
  before enabling those features publicly.

The repository defaults are deliberately conservative. A default monthly
provider quota of 500 is a safety cap, not capacity for a large public launch.
