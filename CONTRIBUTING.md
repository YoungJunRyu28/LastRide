# Contributing to LastRide

LastRide handles location-derived routing and anonymous Business-event
capabilities. Changes must preserve those privacy and security boundaries, not
only make the UI or happy path work.

## Local prerequisites

Use Node 24 and pnpm 10.34.6. Start a local PostgreSQL 16 database and copy the
non-secret development contract from `.env.example` into your own ignored
environment file.

Install dependencies with:

```bash
pnpm install --frozen-lockfile
```

## Database changes

Schema changes require a committed Drizzle migration:

```bash
pnpm --filter @workspace/db generate
pnpm --filter @workspace/db migrate
```

Never use `drizzle-kit push` as a production deployment mechanism. Production
migrations must be backward compatible because the release workflow migrates
the database before shifting traffic.

## Required validation

Before opening a pull request:

```bash
pnpm run typecheck
pnpm run verify:codegen
pnpm run test
EXPO_PUBLIC_API_URL=https://api.invalid.example pnpm run build:ci
```

Database-backed tests must run against a disposable database initialized only
from committed migrations.

## Privacy invariants

- Personal mode stays accountless.
- A Business participant record may persist a display name and calculated
  leave-by timestamp, but not home address, destination, route, GPS location, or
  a plaintext participant/invite capability.
- Provider/cache logs must not contain raw addresses, coordinates, credentials,
  or capability tokens.
- Public OpenStreetMap/Photon community services are development/test fallbacks,
  not production capacity.
- Organizer bearer credentials must use native secure storage in production.

Any proposal that changes one of these invariants must explicitly update
`PRIVACY.md`, tests, and the pull-request privacy section.

## Pull requests

Keep commits reviewable and include regression tests for fixes. Describe schema
or API compatibility, privacy/security impact, provider-cost impact, and the
rollback path for operational changes. Do not merge a production migration that
requires the new application code to be running first.
