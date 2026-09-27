# LastRide Privacy Policy

_Last updated: 27 September 2026_

LastRide (帰り時) helps you catch the last train home. Personal LastRide works
without an account. LastRide for Business adds optional organizer accounts and
temporary event participation. This policy explains what data each mode uses.

**We do not sell personal data or use it for advertising.**

## Personal LastRide

| What                                               | Why                                                     | Where it goes                                                       |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| **Your location** (GPS coordinates)                | Find nearby stations and calculate walking time         | Our API server and transit/routing providers                        |
| **Your saved destinations** (nearest stations and optional addresses) | Last-train, walking and taxi calculations | Stored on your phone; coordinates are sent when needed for a lookup |
| **Your settings**                                  | Language, walking pace, reminders and other preferences | Stored on your phone                                                |

Personal mode does not require your name, email address, phone number, contacts,
photos or a LastRide account.

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

Tracking is off unless you switch it on. It switches itself off once the
night's reminders are finished (by 04:00 at the latest). You can revoke
location access at any time in your phone's settings.

If you joined a Business event, a re-plan sends **only the resulting leave-by
timestamp** to the Business event. It does not send the underlying location,
station, route or destination to the organizer.

## Service providers

To provide core LastRide features, information needed for a query may be sent
to:

- **駅すぱあと API (Val Laboratory Co., Ltd.)** — train timetables, fares and routes.
- **NAVITIME JAPAN Co., Ltd.** (via RapidAPI) — nearby stations, walking and
  driving routes, and nearby places.
- **OpenStreetMap services** — fallback station/geocoding data.
- **Supabase** — organizer authentication for LastRide for Business, when enabled.
- **Expo / Apple / Google push services** — organizer departure alerts.

Transit/routing providers receive the location or station data required for the
lookup, not the Business participant display name.

## How long data is kept

- **Personal data on your phone:** settings, saved destinations, the latest
  plan and local night history stay until you clear them, use **Reset & start
  over**, or uninstall the app. Night history contains plan times and station /
  destination labels, not a GPS trail.
- **Transit-query cache:** server responses may be cached for up to 24 hours,
  keyed by an approximate location (roughly a 100-metre grid), not by a user.
- **Business participants:** your display name, leave-by time and event
  capability are deleted immediately when you leave the event. Otherwise they
  are automatically deleted when that event expires. Events created for a
  night out currently expire at 08:00 Japan time the following morning.
- **Organizer accounts:** organization membership remains until the Business
  account is deprovisioned. A registered push token is removed when the device
  signs out successfully or when it is identified as no longer registered.
- **Server logs:** record endpoint and response status but omit query strings, so
  coordinates and API keys are not written to ordinary request logs.

## Your choices

- Use Personal LastRide without creating an account.
- Leave a Business event at any time to delete that participant record.
- Use **Reset & start over** to erase LastRide's local settings and leave the
  current Business event.
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
**[add your contact email before public release]**
