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
  "ODPT_KEY": "...",
  "USAGE_ADMIN_TOKEN": "...",
  "EXPO_ACCESS_TOKEN": "...",
  "REVENUECAT_SECRET_KEY": "...",
  "GROUP_INVITE_ENCRYPTION_KEY": "..."
}
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are needed only for LastRide for
Business (organizer sign-in), which is off for v1. Deploy with
`ENABLE_BUSINESS=true` to require them and pass them to the API.

Use the pooled production database URL for serverless execution. Enable Expo
Push Security for the production EAS project and store its access token as
`EXPO_ACCESS_TOKEN`. `REVENUECAT_SECRET_KEY` is the RevenueCat secret API key
used to check the `premium` entitlement before a group is created (without it,
production group creation answers 503). `GROUP_INVITE_ENCRYPTION_KEY` is 32
random bytes, base64 or hex (`openssl rand -base64 32`), used to keep group
invites re-shareable by the host; changing it only forces hosts to rotate
invites. Never commit these values or put the secret JSON in a
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

```bash
export AWS_REGION=ap-northeast-1
export CORS_ALLOWED_ORIGINS=https://app.example.com
export ALARM_EMAIL=operations@example.com

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
production database, and the old functions hold
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
   database password (`DATABASE_URL`), `RAPIDAPI_KEY` and `EKISPERT_KEY` (both
   no longer used; just revoke them), and the
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
- Production CORS origins are explicitly configured.
- Organizer authentication and push have been tested on physical devices.
- Background location has been tested on physical iOS and Android devices.
- The mobile production build has a real `EXPO_PUBLIC_API_URL`.
- EAS/APNs/FCM credentials and universal/app-link domain files are configured
  before enabling those features publicly.

The repository defaults are deliberately conservative. The API calls no paid
provider (ODPT data and on-server estimates; iOS uses Apple MapKit), so there
are no provider quotas to size; the public rate limits still apply.

### Production RevenueCat migration safety gate (October 2026)

The new iOS/Android client proves ownership of its device-derived RevenueCat
customer ID before creating paid groups. Older installed builds cannot do so.
Production intentionally returns HTTP 403 with an upgrade-required code for legacy
host-creation requests; no insecure customer-ID fallback exists.

Before running `./infra/deploy.sh production ... --confirm`, complete the
RevenueCat sandbox alias/restore matrix and installed-client compatibility
review in `docs/release/2026-10-premium-identity-hardening.md`. Then explicitly
set `LASTRIDE_PREMIUM_SANDBOX_QA_APPROVED=yes`,
`LASTRIDE_LEGACY_CLIENT_COMPATIBILITY_APPROVED=yes`, and
`LASTRIDE_PREMIUM_ROLLOUT_APPROVED_SHA` to the **exact reviewed main HEAD**.
The script verifies these before accessing AWS secrets/database. A staging
deploy does not require the production approval. Approval flags assert a
human-reviewed condition: they do not make RevenueCat migration automatically
safe and must never be populated just to force a deployment.

## Departure alert recovery and receipt-processing operating costs

`DepartureAlerts` has a **five-minute, all-day EventBridge backup** because
LastRide's primary one-time group alarm Scheduler is best-effort and late
consumer group alerts expire after ten minutes. A 30-minute backup can miss
an entire train departure and must not be restored without equivalent fault
recovery. The backup invokes the Postgres-backed scheduled Lambda **288 times
per day** even when there are no groups. This can exceed the historical Neon
100 CU-hour/month free tier by keeping the DB warm. Before production, check
actual Neon CU usage, AWS Lambda/EventBridge cost, configure account budget
alerts, and fund a suitable tier. The deploy script now also requires the
explicit `LASTRIDE_ALERT_RECOVERY_COST_APPROVED=yes` release-owner attestation
**before accessing AWS secrets or the production database**. Staging is exempt.
The attestation does not itself configure a budget or cap cloud spending. The project prioritizes *correctness* over
assuming a free backend. No live billing/resources were changed here.

`PushReceipts` runs every 15 minutes during Japan evening/night independently
of `EnableBusiness`, with a final 08:00 JST check before the 08:05 privacy
purge. Expo group delivery receipts may take ~15 minutes to become available:
those for the final part of a group night can be lost when the night is
deleted. Track the unverified fraction and resolve retention/privacy policy
before claiming complete push delivery observability. Distinct schedules have
independent SQS DLQs. Test EventBridge Scheduler permissions and all DLQ alarm
routes on staging, and verify that device-token revocation works against
real APNs/FCM sandbox receipts.

### Late-night receipt privacy boundary (October 22, 2026)

A new **receipt-only** table `group_push_receipt_checks` in migration
`0015_foamy_speedball.sql` is intended to solve loss of Expo receipt checks
at the 08:05 group-night privacy purge. Accepted tickets are atomically copied
into the short-lived journal without station, route, leave-by, names or raw
push tokens. The journal keeps an opaque ticket, SHA-256 push-token digest,
nullable recipient/member link, sent time and two-hour deadline. After 08:05,
private group-night records still disappear; the retained operational record
is minimized, **not completely anonymous**, as a still-present recipient
member ID can temporarily identify a group.

**Approve this two-hour retention policy before production deployment.**
The deploy script requires `LASTRIDE_GROUP_RECEIPT_RETENTION_APPROVED=yes` after
real privacy policy review and before reading AWS credentials or touching the
production DB. This is an attestation, not automatic compliance. The
journal expires via receipt-processing checks every 15 minutes all day. A
service outage can delay physical expiry; monitor failed Scheduler, Lambda
and SQS DLQ executions, and validate privacy deletion behavior on staging.
The migration backfills unresolved accepted tickets younger than two hours;
no stale ticket is revived. Deploy DB migration before application code that
inserts/checks the journal. Do not claim all Expo/APNs/FCM receipts are
recovered until physical-device verification and actual receipt timing tests
have passed.
