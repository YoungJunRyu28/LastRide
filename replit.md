# LastRide (帰り時)

LastRide (Japanese subtitle: 帰り時) helps people enjoying a night out in Japan leave in time for their last train, with walking-time-aware reminders and safe fallback choices.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (defaults to port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- API server env (`artifacts/api-server/.env`, gitignored): `ODPT_KEY` (ODPT open data: building the timetable snapshot, live operation information)
- Mobile app → API server: dev builds use the Metro host on port 8080; release builds need `EXPO_PUBLIC_API_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod 3, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/last-ride/` — Expo mobile experience
- `artifacts/last-ride/context/` — persistent language and journey state
- `artifacts/last-ride/constants/colors.ts` — mobile visual tokens

## Architecture decisions

- Personal LastRide stays accountless; Business organizers authenticate, while
  participants join an event through a narrow anonymous capability token.
- Enterprise participant records deliberately contain only display name and
  leave-by time — never GPS coordinates, home, destination or route.
- Provider keys remain server-side. Mobile clients consume the generated
  OpenAPI client and fall back safely where supported.
- PostgreSQL schema changes use committed Drizzle migrations; production
  deployments apply migrations as a separate release step.
- Organizer and participant capability/session tokens use native SecureStore
  (Keychain/Keystore) with a web fallback only where secure native storage does
  not exist.

## Product

- Japanese and English welcome mode
- Required home-station setup with automatic current-location → nearest-station → home-station direction
- Automatic walking-distance and walking-time calculation from device location
- Bottom navigation for leave timing, missed-train alternatives, and settings (home station, walking pace, language)
- Leave-by guidance and last-train route state
- Clear safe alternatives for a missed last train

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Train times come from LastRide's own ODPT timetable engine on the API server (`/api/trains/last`, `/api/trains/first`; see docs/last-train-engine.md). Routes it doesn't cover answer 404 and the iOS app asks Apple Maps instead. 駅すぱあと (Ekispert) is no longer used.
- NAVITIME is no longer used. Station search/nearby on the server come from the ODPT snapshot (licensed subway operators only; JR/private railways aren't found), `/walk` and `/taxi` are straight-line estimates, and `/places` and `/addresses` answer `[]`; iOS uses Apple MapKit on the device for all of these.
- Without an API server the app falls back to sample train times, labelled as such in the UI.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
