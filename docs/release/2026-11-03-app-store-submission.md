# App Store submission: 帰り時 / LastRide 1.0

Prepared 2026-11-03 after the pre-release review. Paste-ready texts first, then the settings and the things only a person can do.

## 1. App Review notes (App Store Connect → App Review Information → Notes)

> LastRide tells people in Japan when to leave for the last train home. It works with Japanese railway stations, so outside Japan it can't find a station near you. To try it from anywhere:
>
> 1. Open the app, choose a language, and set a home station: paste **菊名** (Kikuna) into the search and pick 菊名.
> 2. Skip or allow the notification, alarm and location steps.
> 3. On the main screen you'll see “No station within walking distance”. Tap “Choose a station” and paste **渋谷** (Shibuya) into the search. The app then shows tonight's last train from Shibuya to Kikuna and when to leave, as if you were at Shibuya Station.
> 4. Tap the big “Start tonight” button to start tonight's guidance: reminders and alarms are scheduled for the leave time, and with Premium the lock-screen countdown (Live Activity) appears.
> 5. The “If missed” tab shows the first train, taxis and places to wait nearby.
>
> **Background location:** used only while the user has started tonight's guidance (“Start tonight”), so the station, walking time and reminders follow them while the app is closed. It stops by itself after the last train (04:00 at the latest), and users can choose “Only while using the app”. It's explained before iOS asks.
>
> **Alarms (AlarmKit, iOS 26):** optional, chosen in setup or Settings, so the “leave now” alert sounds even in silent mode.
>
> **Premium** (auto-renewable, ¥190/month or ¥1,200/year, 14-day free trial for new subscribers) adds the lock-screen countdown, home-screen widgets and creating groups. Sandbox purchase and restore work as normal.
>
> **Groups:** invite-only; members share only a display name and tonight's leave time. No accounts.
>
> A screen recording of a real night in Tokyo is attached.

Attach a screen recording (about 60–90 s) of a real evening: start tonight, the Live Activity, an alarm, 乗れなかったら.

## 2. App Privacy (App Store Connect → App Privacy)

| Data type | Collected? | Linked to user? | Tracking? | Purpose |
|---|---|---|---|---|
| Precise location | Yes (sent to Apple Maps and, when Apple can't answer, our server; not stored) | No | No | App functionality |
| Coarse location | No | | | |
| Purchase history | Yes (RevenueCat) | No (anonymous ID) | No | App functionality |
| User ID | Yes (RevenueCat anonymous ID; Sentry and EAS per-install IDs) | No | No | App functionality, analytics: none |
| Crash data | Yes (Sentry) | No | No | App functionality |
| Other user content | Yes (group name, display name) | No | No | App functionality |
| Other data: push token | Yes (groups only) | No | No | App functionality |
| Contact info, health, financial, browsing, search history, contacts, photos | No | | | |

“Not linked” is correct only because there are no accounts and the IDs are random per install. Answer “No” to tracking throughout (no ad networks, no IDFA).

## 3. App Store Connect settings

- **Age rating:** answer the alcohol question honestly. The app is used on nights out (飲み会); it doesn't depict or promote drinking, so “Infrequent/Mild references to alcohol” is the closest, or “None” if the store text never mentions drinking.
- **URLs:** Privacy Policy `https://lastride.jp/privacy/`, Support `https://lastride.jp/support/`, Marketing `https://lastride.jp/`.
- **Terms (EULA):** keep Apple's standard EULA and add to the description: 「利用規約：https://lastride.jp/terms/」.
- **Availability:** Japan only is simplest. If other countries: leave out the EU storefronts (no DSA trader setup). Untick Mac and Apple Vision Pro.
- **Release:** “Manually release this version”.
- **Store name:** 「帰り時 - 終電を逃さない」 is an absolute claim (景表法). Suggested: 「帰り時 - 終電に間に合う時刻を通知」 or 「帰り時 - 終電の出発時刻アラーム」.
- **Small Business Program:** check it's active.

## 4. Dashboards (once)

- **Sentry** → Project Settings → Security & Privacy: turn on **Prevent Storing of IP Addresses**, and add a data-scrubbing rule for `lat`, `lon`, `q`, `query`. The privacy policy now says IPs aren't stored.
- **GitHub** → Settings → Actions → General → Workflow permissions: allow Actions to create pull requests (for the monthly station-list workflow).

## 5. Before release (not blocking the submission)

- **電気通信事業法 届出 (groups):** groups pass one user's leave time to specific other users (closed group), which is likely 「他人の通信の媒介」. Simplest: file the 届出 (free) at the 関東総合通信局 before or right after release. Ask them first if unsure: 関東総合通信局 電気通信事業課.
- **特商法:** a バーチャルオフィス address (a plan that allows 特商法 use) and a 050 number, to answer disclosure requests without your home address.
- **YoungJun's data access:** a short written agreement that he handles user data on your behalf (委託), so the privacy policy's “developers only” is backed by a contract.
- **Lawyer check (optional, ~¥5,000–11,000):** terms §9 and the 届出 question.

## 6. Build and deploy order

1. Commit and push.
2. New build (native changes: permission strings, AlarmKit weak-linked, image picker removed):
   `eas build --platform ios --profile production` then `eas submit --platform ios --latest`.
3. Server: `./infra/deploy.sh staging …` first, then production (log scrubbing, request guards, Business routes off).
4. TestFlight check on the new build: unlock the test tools (Settings → tap the version line 7 times), run one demo night; check an iPhone on iOS 18 or earlier opens the app.
5. Submit for review with the notes above.
