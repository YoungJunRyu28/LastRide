# LastRide for Business — production bring-up

The consumer flow can run without organizer services, but a public Business
launch requires the database, organizer authentication, scheduled workers,
push credentials, and the AWS release workflow below.

## 1. Database

Provision a PostgreSQL database and use the pooled connection URL for Lambda.
Schema changes are committed Drizzle migrations:

```bash
pnpm --filter @workspace/db generate
pnpm --filter @workspace/db migrate
```

Never use `drizzle-kit push` for production. CI proves a clean database can be
created only from committed migrations. Production migrations must remain
backward compatible because migrations are applied before traffic shifts to the
new Lambda version.

## 2. Organizer authentication

Create a Supabase project with email OTP sign-in. The server needs:

```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Native organizer builds use the corresponding public client values:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Never put a Supabase service-role key in an `EXPO_PUBLIC_*` variable.

Organizer bearer/refresh credentials are stored in SecureStore in production.
Organizer accounts are intentionally unavailable on web until LastRide has a
secure browser-session design.

Production organizer membership is provisioned explicitly after the Supabase
user exists. Copy that user's auth-provider user ID, then run the repository
command against the target database:

```bash
DATABASE_URL=... pnpm --filter @workspace/scripts provision-organizer -- \
  --auth-user-id <supabase-user-id> \
  --organization-name "LastRide Business" \
  --display-name "Organizer name" \
  --role owner --confirm
```

The command is idempotent by auth user ID and requires `--confirm`. To add an
organizer to an existing organization, use `--organization-id` instead of
`--organization-name`. Bootstrap emails remain a local/pilot convenience only;
the production SAM template keeps `ENTERPRISE_BOOTSTRAP_EMAILS` empty.

## 3. Provider and API configuration

The API requires:

- `DATABASE_URL`
- `RAPIDAPI_KEY`
- `EKISPERT_KEY`
- provider monthly quota ceilings matching the purchased contracts
- `USAGE_ADMIN_TOKEN`
- Supabase server configuration
- explicit production CORS origins
- HTTPS

The public lookup and anonymous Business routes use Postgres-backed shared rate
limits, so separate Lambda instances do not each grant a fresh allowance.
API Gateway also provides an outer throttle.

The default provider quota values are defensive caps, not a capacity plan. A
large public launch must purchase/configure provider capacity first.

## 4. AWS deployment

AWS Lambda + API Gateway + EventBridge Scheduler is defined declaratively in
`infra/template.yaml`. The legacy imperative deployer is retired; its script
only delegates to the SAM workflow.

Create separate staging and production Secrets Manager secrets and follow
`infra/README.md`:

```bash
./infra/deploy.sh staging last-ride/staging
./infra/deploy.sh production last-ride/production --confirm
```

Production requires `--confirm`, a clean working tree and `HEAD` equal to
`origin/main`.

**First production deploy (cut-over):** the hand-made legacy resources
(`lastride-api`, `lastride-api-scheduled`, their HTTP API, schedules and IAM
roles) keep running until removed. After the new stack is live and the app's
`EXPO_PUBLIC_API_URL` points at its `ApiUrl`, run
`./infra/decommission-legacy.sh` (dry run) and then `--confirm`, rotate every
secret from the old `.env.production`, update Secrets Manager and redeploy.
Follow the "Cut-over from the legacy deployment" section of
`infra/README.md`.

The workflow validates the repository, runs the migration data preflight,
applies committed migrations, builds the
SAM artifact, deploys versioned Lambda aliases, and smoke-tests liveness and
readiness. Existing production stacks use a canary deployment and a post-traffic
readiness hook. CloudWatch errors can trigger rollback.

The three periodic jobs run in the scheduled Lambda (production rates;
staging runs departure alerts every 15 minutes and the others every 30
minutes so its database can scale to zero):

- cleanup every 5 minutes;
- departure alerts every 1 minute;
- Expo push receipt reconciliation every 5 minutes.

Scheduler invocations have bounded retries and dead-letter queues.

## 5. Remote organizer push

Production organizer push needs a real EAS project plus APNs/FCM credentials.
Enable Expo Push Security as well; the server reads its access token from the
production Secrets Manager secret as `EXPO_ACCESS_TOKEN`. For the native
production build:

```text
ENABLE_REMOTE_PUSH=true
EAS_PROJECT_ID=<project-id>
EAS_OWNER=<owner>
```

Notification text is privacy-safe by default and does not put the participant
display name on the lock screen. Only enable
`ENTERPRISE_PUSH_INCLUDE_NAME=true` after making that privacy decision
explicitly.

The server reserves each participant/device/notification kind once, batches up
to 100 messages per Expo request, caps concurrent Expo connections at six,
records tickets in response order, reconciles receipts deterministically,
retires devices reported as `DeviceNotRegistered`, and ages missing receipts
out instead of leaving them pending forever. Failed batch submissions are
released for the next scheduled pass rather than spinning inside one Lambda.

## 6. Event join links

Without a public domain, invite sharing uses:

```text
last-ride://join?token=...
```

For public HTTPS links:

```text
EXPO_PUBLIC_APP_JOIN_BASE_URL=https://<public-domain>
```

The Expo config adds the native associated-domain / Android intent filter when
that HTTPS base is present. The domain still must host the corresponding Apple
association and Android asset-links files.

## 7. Mobile provider behavior

Ordinary production builds require `EXPO_PUBLIC_API_URL` and do not silently
switch to sample timetable data. Direct public OpenStreetMap/Photon fallbacks
are disabled in production by default so a public launch does not put
uncontrolled load on community infrastructure.

`EXPO_PUBLIC_ENABLE_COMMUNITY_FALLBACKS=true` exists for development or
controlled testing only.

## 8. Required release checks

Before public release, verify all of the following in staging:

1. Fresh database creation using only committed migrations.
2. Organizer OTP sign-in on a physical native device.
3. Event creation and invite rotation.
4. Accountless join from a second device.
5. Host roster contains only display name + leave-by time.
6. Participant re-plan updates only leave-by time on the server.
7. Explicit leave deletes the server participant record and remains retryable
   if the server is temporarily unavailable.
8. Closing/expiry cleanup behaves according to the privacy policy.
9. Real organizer push delivery and receipt reconciliation.
10. Background tracking start/stop and denied-permission paths on iOS/Android.
11. HTTPS join links on both platforms if enabled.
12. Production provider quotas match the actual contracts.
13. The privacy contact path and store privacy disclosures are current.

## 9. Generic container option

The API still has a host-agnostic Docker target for local or alternate hosting:

```bash
docker build -f Dockerfile.api -t lastride-api .
docker run --rm -p 8080:8080 --env-file .env lastride-api
```

An always-on container runs periodic workers from `index.ts`. Lambda does not;
that is why the production SAM stack uses the dedicated scheduled handler.

The container exposes `/api/healthz` and the application exposes
`/api/readyz`. Migrations remain a separate release step.
