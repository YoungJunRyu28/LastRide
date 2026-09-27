# LastRide for Business — deployment checklist

This document is the production bring-up order for the organizer / nomikai
feature. The consumer LastRide flow can continue to run without these services.

> **Production target: AWS Lambda + API Gateway** (agreed by Nicholas and
> YoungJun, 2026-09-27). This is what's deployed and live
> (`artifacts/api-server/scripts/deploy-lambda.sh`), verified against the
> real database. §7's Docker target still works and stays documented as a
> non-primary option — e.g. for local testing — but is not what's running in
> production. See §3 for why Lambda needed one code change (the background
> workers moved from an in-process timer to a separate scheduled Lambda,
> since Lambda isn't an always-on process).

## 1. PostgreSQL

Provision a PostgreSQL database and set `DATABASE_URL` on the API server.

Apply committed migrations from the repository:

```bash
pnpm --filter @workspace/db migrate
```

Do not use `push-force` in production. Schema changes should be generated and
reviewed first:

```bash
pnpm --filter @workspace/db generate
```

CI verifies that committed migrations match the Drizzle schema.

## 2. Organizer authentication

Create a Supabase project and enable email OTP sign-in.

Set these API-server variables:

```text
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Set the corresponding public Expo client values:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Never put a Supabase service-role key in an `EXPO_PUBLIC_*` variable.

For the first pilot only, add approved organizer email addresses to
`ENTERPRISE_BOOTSTRAP_EMAILS`. On first authenticated access, LastRide creates
the organization/member record. Remove bootstrap emails after provisioning.

## 3. API hosting

The API host needs:

- `DATABASE_URL`
- transit-provider keys
- Supabase server auth configuration
- HTTPS
- either an always-on process (the server runs enterprise cleanup/push
  workers via `setInterval` — true for the Docker target), **or**, on Lambda,
  the separate `lastride-api-scheduled` function invoked by EventBridge on
  the same schedule (see `src/scheduled.ts`). A bare Lambda deployment is
  not always-on, so the workers cannot run as an in-process timer there —
  this is why Lambda needed the separate function rather than just deploying
  `index.ts` as-is.

Set the mobile app's `EXPO_PUBLIC_API_URL` to the HTTPS API origin.

Expired event participant data is purged by the server worker every five
minutes. Participants who explicitly leave are deleted immediately.

## 4. Remote organizer push notifications

Organizer departure alerts require a real Expo/EAS project and valid APNs/FCM
credentials.

For production native builds:

```text
ENABLE_REMOTE_PUSH=true
```

When false, LastRide keeps the existing local/free-signing configuration and
does not depend on the remote-push entitlement.

The API stores Expo push tickets, checks receipts after the recommended delay,
and removes device registrations that Expo reports as `DeviceNotRegistered`.

## 5. Event join links

Without configuration, invite sharing uses the app custom scheme:

```text
last-ride://join?token=...
```

For public QR/share links, configure an HTTPS app-link domain:

```text
EXPO_PUBLIC_APP_JOIN_BASE_URL=https://<public-domain>
```

The resulting link is `https://<public-domain>/join?token=...`.

Before relying on HTTPS links, configure the matching iOS Associated Domains /
Android App Links files on that domain. Until then, the custom scheme remains
the reliable native-app path.

## 6. Required pre-release checks

1. Apply the database migration to a staging database.
2. Sign in with a provisioned organizer email.
3. Create an event and rotate its invite once.
4. Join from a second device without creating an account.
5. Confirm only display name + leave-by time appear in the host roster.
6. Move/re-plan on the participant device and confirm leave time updates.
7. Verify leaving the event removes the participant immediately.
8. Verify event expiry purges remaining participant records.
9. Verify a real organizer push notification and its Expo receipt.
10. Replace the placeholder privacy contact email before public release.

## 7. Generic container deployment

The API has a host-agnostic Docker target:

```bash
docker build -f Dockerfile.api -t lastride-api .
docker run --rm -p 8080:8080 --env-file .env lastride-api
```

Apply database migrations as a release/pre-deploy step before starting the new
API image:

```bash
DATABASE_URL=... pnpm --filter @workspace/db migrate
```

The container exposes `/api/healthz` as its health check. The image itself does
not run migrations automatically, which avoids multiple replicas racing to
perform schema changes during a rolling deploy.

## 8. Reverse proxy and rate limiting

Anonymous event join/update endpoints have an in-process first-line rate limit.
When the API runs behind a trusted hosting/load-balancer proxy, set
`TRUST_PROXY_HOPS` to the number of trusted hops (commonly `1`). LastRide
then uses Express's validated `req.ip` resolution for per-client limits rather
than trusting a raw `X-Forwarded-For` header.

For a multi-replica/high-volume deployment, replace the in-process limiter with
a shared Redis-backed limiter so limits are coordinated across instances.
