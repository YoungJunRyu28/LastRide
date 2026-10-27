# Group operation CORS and shared public lookup fairness

Reviewed 2026-10-27. Review PR change; not production approval.

## Browser group join/create preflight

The client includes X-Group-Join-Key and X-Group-Create-Key to safely retry
requests after network interruptions. These are recognized by group routes
and OpenAPI, but were missing from Express CORS allowed-header list. Browsers
require a successful preflight for custom headers. Native HTTP clients do not
usually enforce browser CORS, making the issue easy to miss in device testing.

The server allows both keys for approved origins and retains the existing
X-Premium-Device-Secret, customer ID and member-token headers. Production
preflight tests cover joining and paid group creation; unapproved origins
receive no browser CORS permission. CORS is not authentication or
authorization: server-side capability checks remain mandatory. Confirm the
live frontend is present in CORS_ALLOWED_ORIGINS.

## Anonymous public lookup fairness

The old local limiter shared a single 60/min pool across train, station, taxi,
place, walking and address queries from any given IP. One actual journey
calculation can make many API requests, and travelers behind a busy venue
or campus Wi-Fi can exhaust that allowance.

- Each lookup family defaults to a separate 240/min per-IP budget. Last/first
  train, partway and disruption lookups share a train-family bucket.
- The independent mandatory aggregate guard defaults to 720/min per IP,
  preventing callers from bypassing the budget by rotating endpoint paths.
- Per-family rejects run before aggregate counting, preventing abusive retries
  against one already-exhausted family from wasting the other families' budget.
- PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE overrides the family cap.
  PUBLIC_LOOKUP_TOTAL_RATE_LIMIT_PER_MINUTE overrides the aggregate cap.
  Neither accepts zero, negative, or invalid numeric values.
- Both limiters are in memory per warm runtime and avoid scale-to-zero database
  wakeups. The API gateway still enforces a deployment-wide ceiling.

Regression tests simulate 50 users sharing one IP making four train and four
station requests each, hot-family abuse, independent IPs and total saturation.
This does not prove real-world gateway or multi-Lambda protection: stage
realistic NAT load, measure CPU/memory cost and provider limits, and tune
configuration accordingly.

Deployment gates: see DEPLOYMENT-STOP-POINT.md.
