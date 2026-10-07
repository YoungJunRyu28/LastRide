# LastRide Privacy Policy

_Last updated: 7 October 2026_

LastRide (帰り時) helps you catch the last train home. Personal LastRide works
without an account. LastRide for Business adds optional organizer accounts and
temporary event participation. This policy explains what data each mode uses.

**We do not sell personal data or use it for advertising.**

## Personal LastRide

| What                                                                  | Why                                                     | Where it goes                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| **Your location** (GPS coordinates)                                   | Find nearby stations and calculate walking time         | Our API server and transit/routing providers                        |
| **Your saved destinations** (nearest stations and optional addresses) | Last-train, walking and taxi calculations               | Stored on your phone; coordinates are sent when needed for a lookup |
| **Your settings**                                                     | Language, walking pace, reminders and other preferences | Stored on your phone                                                |

Personal mode does not require your name, email address, phone number, contacts,
photos or a LastRide account.

### Optional mobility learning

Mobility learning is **off by default**. If you explicitly enable **Improve
timing predictions** in Settings, LastRide may derive timing outcomes while
night-out tracking is active. These can include:

- time between the leave recommendation and sustained movement;
- provider-predicted versus observed walking duration and walking distance;
- coarse total ascent/descent derived on-device from usable altitude samples;
- time from reaching the public station area to boarding;
- whether the planned train was caught;
- public station and line identifiers, a coarse hour bucket, day type and a
  confidence score.

The learning upload does **not** include your home address, destination address,
starting coordinates, raw GPS samples or a GPS trail. A random 256-bit
installation token is kept in the device secure store. The server stores only
the SHA-256 digest of that token and uses it to deduplicate uploads and honor a
delete request from the same installation.

Aggregate station estimates are available to users whether or not they
contribute observations. Personal timing residuals stay on the device. Turning
sharing off stops new learning observations from being contributed. **Delete
shared learning data** removes observations associated with that installation
from the server and clears its local learning profile; the deletion requires a
network connection so the app can confirm the server-side copy was removed.

## LastRide for Business

Business participation is optional and is separate from your personal travel
profile.

**Participants:** when you join an organizer's event, our server stores only
your chosen display name, the event you joined, your current calculated
leave-by time, and a random capability token used by your device to update or
leave that event. The organizer can see your display name and leave-by time.

The Business event record does **not** store your GPS location, home address,
home station, walking pace, route, destination or personal LastRide settings.

**Organizers:** organizer sign-in uses a work email address. Authentication is
handled by Supabase when configured. We store the organizer's authentication
user ID, organization membership and registered push-notification device token.
Organizer push notifications are sent through Expo's Push Service and the
underlying Apple or Google push service.

## When location is used

- **While the app is open**, to calculate your leave-by time.
- **While night-out tracking is on**, also in the background, so your plan and
  reminders stay current as you move.

Tracking is off unless you switch it on. LastRide is configured to end a
night's tracking once its reminders are finished and uses 04:00 as a hard
stop. Mobile operating systems do not guarantee an exact background wake at
04:00, so the app enforces that stop on the first location wake at or after the
deadline. You can stop tracking or revoke location access at any time.

If you joined a Business event, a re-plan sends **only the resulting leave-by
timestamp** to the Business event. It does not send the underlying location,
station, route or destination to the organizer.

## Service providers

To provide core LastRide features, information needed for a query may be sent
to:

- **駅すぱあと API (Val Laboratory Co., Ltd.)** — train timetables, fares and routes.
- **NAVITIME JAPAN Co., Ltd.** (via RapidAPI) — nearby stations, walking and
  driving routes, and nearby places.
- **OpenStreetMap-based community services** — fallback station/geocoding or
  routing data only in development or explicitly opted-in test builds; ordinary
  production builds keep these public fallbacks disabled.
- **Supabase** — organizer authentication for LastRide for Business, when enabled.
- **Expo / Apple / Google push services** — organizer departure alerts.
- **Sentry (Functional Software, Inc.)** — crash and error reports, when
  enabled in the build. A report contains the error and stack trace, the app
  version and the device/OS model. It does not include your location,
  destinations, stations, searches, Business display name or join links:
  query strings are removed from URLs and console output is not collected.

Transit/routing providers receive the location or station data required for the
lookup, not the Business participant display name.

## How long data is kept

- **Personal data on your phone:** settings, saved destinations, the latest
  plan and local night history stay until you clear them, use **Reset & start
  over**, or uninstall the app. Night history contains plan times and station /
  destination labels, not a GPS trail.
- **Provider-query cache:** server responses may be cached for no more than
  24 hours and are never keyed by a user account. Cache lookup keys are stored
  only as one-way SHA-256 digests, so raw coordinate, station-name and address
  query keys are not persisted. Cached payloads may contain the public
  station/place/address candidates returned by a provider. Expired cache rows
  are physically deleted by the server maintenance job.
- **Business participants:** your display name, leave-by time and event
  capability are deleted immediately after a successful leave request or when
  the organizer closes the event. If a leave request cannot reach the server,
  the app retains the anonymous capability locally so deletion can be retried,
  except after **Reset & start over**, which always erases it from your phone.
  Any participant data the server still holds is deleted when the event expires.
  Events created for a night out currently expire at 08:00 Japan time the
  following morning.
- **Organizer accounts:** organization membership remains until the Business
  account is deprovisioned. A registered push token is removed when the device
  signs out successfully or when it is identified as no longer registered.
- **Optional mobility-learning observations:** retained for at most 365 days and
  then deleted. Deleting the installation's shared learning data earlier removes
  its contributor row and associated observations immediately after the server
  accepts the request. Aggregate predictions are computed from eligible
  observations and do not expose individual trip records to other users.
- **Crash reports:** kept by Sentry for up to 90 days, then deleted.
- **Server logs:** record endpoint and response status but omit query strings.
  Cache errors also omit raw cache keys, so coordinates, address queries and API
  keys are not written to ordinary application logs.

## Your choices

- Use Personal LastRide without creating an account.
- Leave a Business event at any time to delete that participant record.
- Use **Reset & start over** to erase LastRide's local settings and leave the
  current Business event. If the server can't be reached, your phone's copy is
  still erased and the server-side participant record is removed when the
  event expires.
- Turn optional mobility-learning sharing on or off in Settings. Use **Delete
  shared learning data** to remove this installation's shared observations and
  local learning profile; if the device is offline, retry once it can reach the
  server so deletion can be confirmed.
- Turn off location permission to stop location access.
- Organizer account deletion/deprovisioning requests can be made through the
  contact below.

## Children

LastRide is not directed at children under 13 and does not knowingly collect
their data.

## Changes

If this policy changes, the updated version will be published here with a new
date at the top.

## Contact

Questions, privacy requests or organizer-account deletion requests:
Repository contact: https://github.com/nicknr100/LastRide

Do not include sensitive personal information in a public GitHub issue. If a
request requires account or identity details, first ask the maintainers for a
private follow-up channel.
