# LastRide Privacy Policy

_Last updated: 11 October 2026_

LastRide (帰り時) helps you catch the last train home. It works without an
account. Optional groups, the Premium subscription and LastRide for Business
(temporary events joined by invite link) are described below.

**We do not sell personal data or use it for advertising.**

## Personal LastRide

| What                                                                  | Why                                                     | Where it goes                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| **Your location** (GPS coordinates)                                   | Find nearby stations and calculate walking time         | Apple Maps on iPhone; our API server on Android                     |
| **Your saved destinations** (nearest stations and optional addresses) | Last-train, walking and taxi calculations               | Stored on your phone; coordinates are sent when needed for a lookup |
| **A “tonight only” station**                                          | Plan for somewhere else tonight without saving it       | Stored on your phone; cleared the next day                          |
| **Your settings**                                                     | Language, time to spare, reminders and other preferences | Stored on your phone                                                |
| **Tonight’s plan**                                                    | Show the plan offline, in widgets and on the lock screen | Stored on your phone; replaced by the next night’s plan              |

LastRide keeps no movement history and no record of past nights. Widgets and
the lock-screen countdown (iOS Live Activity, Android notification) display
tonight's plan from your phone; nothing is sent to us for them.

Location is used in the background only during night tracking, only if you
chose **Update when closed**, and tracking stops by itself after the last train
(by 04:00 Japan time at the latest).

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
home station, time-to-spare setting, route, destination or personal LastRide settings.

**Organizers:** organizer sign-in uses a work email address. Authentication is
handled by Supabase when configured. We store the organizer's authentication
user ID, organization membership and registered push-notification device token.
Organizer push notifications are sent through Expo's Push Service and the
underlying Apple or Google push service.

## Groups

Groups (飲み会 groups) are optional and accountless. Creating a group needs a
LastRide Premium subscription; joining is free.

**What the server stores:** the group name, each member's chosen display name
for that group, their role (host or member), a random capability token per
member (stored only as a one-way hash), notification language and on/off
setting, and an Expo push token if the member turned on notifications. Invite
links and join codes are stored as one-way hashes for lookup, plus an encrypted
copy so the host can re-share the current invite.

**Tonight:** when the host starts tonight and you choose 今夜参加する, the server
stores **only your leave-by time** (and whether you reported 乗り遅れた). It
never receives your location, station, route or destination. Other members of
the group see your display name and leave-by time.

When you create a group we check your subscription with RevenueCat using your
RevenueCat app user ID; the server does not store that ID.

## Premium

Purchases, billing and refunds are handled by Apple's App Store (or Google
Play on Android); LastRide never receives your payment details. Subscription
status is managed with **RevenueCat** under an anonymous app user ID, not your
name or email. The app reads your subscription status from RevenueCat to
unlock Premium features, and the server checks it with that ID when you create
a group.

## When location is used

- **While the app is open**, to calculate your leave-by time.
- **During night-out tracking**, you choose either updates only while LastRide
  is open, or optional background location so your station, walk estimate and
  leave-by time can update as you move even when the app is closed. If you
  choose open-app-only mode, previously scheduled reminders still run from
  your most recently calculated plan, but that plan is not location-refreshed
  while the app is closed.

Tracking is off unless you switch it on. LastRide is configured to end a
night's tracking once its reminders are finished and uses 04:00 as a hard
stop. Mobile operating systems do not guarantee an exact background wake at
04:00, so the app enforces that stop on the first location wake at or after the
deadline. You can stop tracking or revoke location access at any time.

If you joined a Business event, or opted in to tonight for a group, a re-plan
sends **only the resulting leave-by timestamp** to the event or group. It does not send the underlying location,
station, route or destination to the organizer.

## Service providers

To provide core LastRide features, information needed for a query may be sent
to:

- **Train timetables** are calculated on LastRide's own server from 公共交通オープンデータセンター
  (ODPT) open data; the server sends no query to a third party for them.
- **Apple MapKit** (iOS) — station search, nearby stations, walking and
  driving routes, addresses and nearby places are looked up by Apple Maps
  services from your iPhone, under Apple's privacy policy. On Android (and as
  a fallback) LastRide's own server answers station searches from ODPT data and
  estimates walking and taxi times itself, without sending the query to a
  third party.
- **OpenStreetMap-based community services** — fallback station/geocoding or
  routing data only in development or explicitly opted-in test builds; ordinary
  production builds keep these public fallbacks disabled.
- **Supabase** — organizer authentication for LastRide for Business, when enabled.
- **Expo / Apple / Google push services** — organizer departure alerts and
  group notifications (tonight started, a member's leave time, 乗り遅れた).
- **RevenueCat** — subscription status for Premium (anonymous app user ID),
  read by the app and checked by the server when you create a group.
- **Apple App Store / Google Play** — Premium purchases and billing.
- **Sentry (Functional Software, Inc.)** — crash and error reports, when
  enabled in the build. A report contains the error and stack trace, the app
  version and the device/OS model. It does not include your location,
  destinations, stations, searches, Business display name or join links:
  query strings are removed from URLs and console output is not collected.

Transit/routing providers receive the location or station data required for the
lookup, not the Business participant display name.

## How long data is kept

- **Personal data on your phone:** settings and saved destinations stay until
  you change them, use **Reset & start over**, or uninstall the app. A “tonight
  only” station is cleared the next day; tonight's plan is replaced by the next
  night's. Apple Maps results are not kept beyond the night they were used for,
  except a station or address you choose to save as a destination.
- **Lookups on our server:** train-time, station and estimate requests are
  answered from the server's own data and are not stored.
- **Business participants:** your display name, leave-by time and event
  capability are deleted immediately after a successful leave request or when
  the organizer closes the event. If a leave request cannot reach the server,
  the app retains the anonymous capability locally so deletion can be retried,
  except after **Reset & start over**, which always erases it from your phone.
  Any participant data the server still holds is deleted when the event expires.
  Events created for a night out currently expire at 08:00 Japan time the
  following morning.
- **Groups:** every leave-by time (and 乗り遅れた flag) is deleted when the
  night ends — automatically at 08:00 Japan time the following morning, or
  earlier if the host ends it. Your membership (display name, hashed token,
  push token) is deleted when you leave, when the host removes you, or when the
  host disbands the group, which deletes the group and everything in it.
- **Organizer accounts:** organization membership remains until the Business
  account is deprovisioned. A registered push token is removed when the device
  signs out successfully or when it is identified as no longer registered.
- **Crash reports:** kept by Sentry for up to 90 days, then deleted.
- **Server logs:** record endpoint and response status but omit query strings.
  Cache errors also omit raw cache keys, so coordinates, address queries and API
  keys are not written to ordinary application logs.

## Your choices

- Use Personal LastRide without creating an account.
- Leave a Business event at any time to delete that participant record.
- Opt out of tonight, turn group notifications off, or leave a group at any
  time; leaving deletes your membership record.
- Use **Reset & start over** to erase LastRide's local settings and leave the
  current Business event. If the server can't be reached, your phone's copy is
  still erased and the server-side participant record is removed when the
  event expires.
- Choose **Only while app is open** when starting night-out tracking to avoid
  background location access. LastRide remembers the choice; change it any
  time in **Settings › Night location**.
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
