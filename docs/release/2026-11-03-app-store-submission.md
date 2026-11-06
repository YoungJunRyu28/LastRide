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
| User ID | Yes (RevenueCat anonymous ID) | No | No | App functionality |
| Device ID | Yes (Sentry and EAS random per-install IDs) | No | No | App functionality |
| Crash data | Yes (Sentry) | No | No | App functionality |
| Other user content | Yes (group name, display name) | No | No | App functionality |
| Other data: push token | Yes (groups only) | No | No | App functionality |
| Contact info, health, financial, browsing, search history, contacts, photos | No | | | |

“Not linked” is correct only because there are no accounts and the IDs are random per install. Answer “No” to tracking throughout (no ad networks, no IDFA).

## 3. App Store Connect settings

- **Age rating:** answer the alcohol question honestly. The app is used on nights out (飲み会); it doesn't depict or promote drinking, so “Infrequent/Mild references to alcohol” is the closest, or “None” if the store text never mentions drinking.
- **URLs:** Privacy Policy `https://lastride.jp/privacy/`, Support `https://lastride.jp/support/`, Marketing `https://lastride.jp/`.
- **Terms (EULA):** keep Apple's standard EULA and add to the description: 「利用規約：https://lastride.jp/terms/」.
- **Availability:** every country except the 27 EU storefronts (selling there needs DSA trader status, which publishes an address and phone number) and mainland China (needs an ICP filing). Taiwan and Hong Kong are fine. Tourists can only download from their own country's store, so this is how visitors to Japan get the app. Prices convert from ¥190 / ¥1,200 automatically; Apple handles each country's tax. The privacy policy covers users outside Japan (「日本国外からのご利用」). Untick Mac and Apple Vision Pro. Countries can be added later without a new review.
- **Release:** “Manually release this version”.
- **Store name:** 「帰り時 - 終電を逃さない」 is an absolute claim (景表法). Use one from section 3a.
- **Small Business Program:** check it's active.

## 3a. Store page texts (ASO)

Only the title, subtitle and keywords affect search; the description and promotional text are for people. The Japan store indexes both the Japanese and the English (U.S.) listing, so their keyword fields add up (about 200 characters). Japanese has no spaces, so put in the whole phrases people type (終電検索, not 終電 + 検索). Never use other apps' names (Apple rejects it).

**Japanese (primary)**

| Field | Text | Limit |
|---|---|---|
| Name | 終電アラーム・終電通知 - 帰り時 | 30 |
| Subtitle | 乗換と徒歩込みで、出る時間がわかる | 30 |
| Keywords | 終電検索,終電時間,最終電車,乗換検索,乗り換え,電車,時刻表,帰宅,飲み会,始発,タクシー,カウントダウン,ウィジェット,ロック画面,最寄り駅,電車時間,間に合う,出発時刻 | 100 |
| Promotional text | 忘年会シーズン、終電の時刻を気にせず楽しめます。出る時間をロック画面でカウントダウン。年末年始の土休日ダイヤにも対応。 | 170 |

What the app does comes first and the brand last, since nobody searches for 帰り時 yet (swap the order once people do). The home-screen name stays 帰り時. 出発時刻 is only a keyword, for search: inside the app the user's time is always 出る.

**English (U.S.): what tourists see, and also indexed in Japan**

| Field | Text | Limit |
|---|---|---|
| Name | Last Train Alarm: LastRide | 30 |
| Subtitle | Tokyo & Japan: when to leave | 30 |
| Keywords | shuden,osaka,nagoya,fukuoka,yokohama,metro,subway,nightlife,taxi,countdown,widget,transit,station | 100 |
| Promotional text | Out late in Japan? LastRide counts down to when you need to leave for the last train home, with the walk to the station included. | 170 |

Words in the name and subtitle don't need repeating in the keywords. Check each field's length in App Store Connect before saving.

**Before submitting: check the keywords against real data (15 min).** In Apple Search Ads (free account, no ads needed), look up each keyword's popularity for Japan. Swap out anything at or near 5, the lowest score, for a better one from the same idea (e.g. 終電 アプリ, 終電 通知). The lists above are educated guesses until this is done. Keywords can still change with any later update; the name and subtitle matter most.

**Choosing keywords:** relevant first, then popularity, then competition. A new app won't rank for the biggest terms (乗換, 電車) at first, so the specific ones (終電検索, 終電時間, 最終電車) are where early downloads come from. Swap in bigger terms as the app grows.

**When texts can change:** the name, subtitle and keywords only change with a new version sent for review; promotional text and the description's wording can change any time. So get the three search fields right before submitting, and change them with a later update, not daily.

**Keyword data:** an Apple Search Ads account shows Apple's popularity score for each keyword in Japan, free, without running ads. Use it to choose between close options (終電検索 vs 終電アラーム).

**Description:** not used for search, so write it for people. The first two or three lines show before 「さらに表示」, so open with what the app does for you (「飲み会の帰り、終電に間に合うには何時に出ればいいかを教えてくれるアプリです。」), then the features as short benefits, then 「利用規約：https://lastride.jp/terms/」. No keyword lists.

**Description, Japanese (paste as is, max 4,000 characters):**

```
飲み会の帰り、終電に間に合うには何時にお店を出ればいいか。帰り時は、今いる場所から最寄り駅までの徒歩時間と終電の時刻をもとに、「ここを出る時刻」を教えてくれるアプリです。

■ 出る時刻がひと目でわかる
現在地から近くの駅と終電を調べ、駅までの徒歩と乗り換えを含めて「何時にここを出ればいいか」を表示します。余裕をどれだけ取るかも選べます。

■ 通知とアラームでお知らせ
30分前・15分前・出る時刻など、好きなタイミングで通知。iOS 26以降は、マナーモードでも鳴るアラームにもできます。

■ 移動しても自動で更新
「案内を開始」すると、お店を移っても最寄り駅と出る時刻を追いかけます。終電が出たら自動で止まります。

■ 乗れなかったときも
始発の時刻、タクシー料金の目安、朝まで過ごせる近くの場所をすぐに確認できます。

■ 飲み会グループ
メンバーの出る時刻だけを共有して、誰がいつ帰るかがわかります。現在地や自宅は共有されません。参加は無料です。

■ 1本前・2本前も選べる
終電の1本前、2本前に乗りたい夜も、同じように案内します。

■ アカウント登録は不要
帰る場所や設定はiPhoneの中に保存されます。移動履歴は残りません。

【プレミアム】
・ロック画面とダイナミックアイランドのカウントダウン
・ホーム画面・ロック画面のウィジェット
・グループの作成
・帰る場所をいくつでも登録
月額190円、年額1,200円（月あたり約100円）。初めての方は14日間無料でお試しいただけます。

【自動更新について】
・お支払いは購入の確認時にApple Accountに請求されます。
・無料期間または現在の期間が終わる24時間前までに解約しない限り、自動で更新されます。
・解約はiPhoneの「設定」→ 自分の名前 →「サブスクリプション」から行えます。

【ご注意】
時刻は鉄道会社の時刻表とAppleマップの情報をもとにした目安です。遅延や運休、混雑により実際と異なる場合があります。最新の運行情報は各鉄道会社の公式情報もご確認ください。
対応エリア：首都圏の地下鉄（東京メトロ・都営）ほか、JR・私鉄はAppleマップの情報で調べます。

利用規約：https://lastride.jp/terms/
プライバシーポリシー：https://lastride.jp/privacy/
```

**Description, English:**

```
Out late in Japan? LastRide tells you when to leave where you are to catch the last train home, with the walk to the station included.

• Know when to leave
LastRide finds the nearest stations and tonight's last train, then works out when you need to head out, counting the walk and any changes. Choose how much time to spare.

• Reminders and alarms
Get a reminder 30 or 15 minutes before, and when it's time to go. On iOS 26 and later it can be an alarm that rings even in silent mode.

• Follows you as you move
Start tonight's guidance and your station and leave time update as you change places. It stops by itself once the last train has gone.

• If you miss it
See the first train, a taxi fare estimate and places nearby to wait until morning.

• Groups for nights out
Share only your leave time with friends, so everyone knows who's heading home when. Your location and home are never shared. Joining is free.

• No account needed
Your destinations and settings stay on your iPhone. No travel history is kept.

PREMIUM
• Countdown on the Lock Screen and Dynamic Island
• Home Screen and Lock Screen widgets
• Create groups
• Unlimited saved destinations
¥190 a month or ¥1,200 a year. New subscribers get a 14-day free trial.

Payment is charged to your Apple Account at confirmation of purchase. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the trial or current period. Manage or cancel in Settings → your name → Subscriptions.

Times are estimates based on railway timetables and Apple Maps, and may differ because of delays, suspensions or crowding. Check your railway operator for the latest service information.

Terms of Use: https://lastride.jp/en/terms/
Privacy Policy: https://lastride.jp/en/privacy/
```

**Screenshots:** the first three show in search results. Large Japanese text, high contrast, benefits rather than features. No 元町・中華街.
1. 「あと何分で出ればいい？」 (home screen with the countdown)
2. 「ロック画面でカウントダウン」 (Live Activity)
3. 「乗れなかったら：始発・タクシー・休める場所」

Don't try to explain everything in the first screenshot; it only has to make people look at the next one. Make an English set for the English listing too (tourists see it): 'When do I need to leave?', 'Countdown on your lock screen', 'Missed it? First train, taxis, places to wait'.

**After launch:** note the rank for the top five keywords each week before changing anything. Promotional text can change any time without review (seasons: 忘年会, 年末年始, 歓送迎会 in March–April).

**Ratings:** shown per country (Japan's don't show to US users). Never offer anything in return for a review, and don't nudge people toward five stars (App Review rejects both). Reply to reviews in App Store Connect; people read the replies.

**Not for us yet:** localized pricing (Japan is the market; Apple converts prices for tourists' stores). Revisit if a country outside Japan grows.

**Review prompt (build 15):** `lib/reviewPrompt.ts`. Apple's prompt after 今夜の案内 has been used on two different nights, only between 08:00 and 19:00 JST and never while guidance is on; at most once per 120 days from our side (iOS: 3 a year). It never shows in TestFlight, so it can't be checked there.

## 4. Dashboards (once)

- **Sentry** → Project Settings → Security & Privacy: turn on **Prevent Storing of IP Addresses**, and add a data-scrubbing rule for `lat`, `lon`, `q`, `query`. The privacy policy now says IPs aren't stored.
- **GitHub** → Settings → Actions → General → Workflow permissions: allow Actions to create pull requests (for the monthly station-list workflow).

## 5. Before release (not blocking the submission)

- **電気通信事業法 届出 (groups):** groups pass one user's leave time to specific other users (closed group), which is likely 「他人の通信の媒介」. Simplest: file the 届出 (free) at the 関東総合通信局 before or right after release. Ask them first if unsure: 関東総合通信局 電気通信事業課.
- **特商法:** a バーチャルオフィス address (a plan that allows 特商法 use) and a 050 number, to answer disclosure requests without your home address.
- **YoungJun's data access:** a short written agreement that he handles user data on your behalf (委託), so the privacy policy's “developers only” is backed by a contract.
- **Lawyer check (optional, ~¥5,000–11,000):** terms §9 and the 届出 question.

## 5a. After release: trade name as the App Store seller

Now the App Store shows the developer's real name as the seller (Individual account). Apple support can convert an Individual account to an Organization under a 屋号 (trade name), keeping the app, subscriptions and RevenueCat (one developer's report: note.com/lofty_takeru, 2026-08). Apple's published rule is that organizations must be legal entities, so it may be refused. Do it after release, while revenue is small.

**Needed**
- 開業届 at the tax office with the 屋号 (check first that your visa allows self-employment).
- A business address: the same バーチャルオフィス as for 特商法, on a plan that allows D-U-N-S and 特商法 use.
- A D-U-N-S number under the 屋号 (free through Apple's lookup, about 1–2 weeks). The name must match the 開業届 and Apple exactly, in roman letters.
- Email on our own domain (e.g. dev@lastride.jp); Gmail isn't accepted. The website showing the business (lastride.jp does).

**Cost and time:** about ¥10,000 a year, mostly the virtual office we need anyway. About 1.5 months from start to finish, about 10 hours of work.

**Steps:** ask Apple Developer support whether the conversion is possible for our account → D-U-N-S → the migration form → the organization details.

**Watch for:** the Paid Applications Agreement can become invalid partway through, which pauses subscription payouts until fixed. Then bank and tax-form errors (the report needed Apple Finance and a W-8BEN, in English). Check App Store Connect → Business after approval, before assuming it's done.

**Name:** 「LastRide」 if this stays the main app (matches lastride.jp); a neutral umbrella name if more apps are planned. Free as a .jp domain, checked in J-PlatPat. No 株式会社, 合同会社, Inc. or Ltd. (not allowed for a sole proprietor).

**Note:** the 特商法 page still gives the seller's name on request; this changes what the store page shows, not what the law requires. The fully official route is a 合同会社 (about ¥100,000 to set up, about ¥70,000 a year in 均等割 even at a loss), which isn't worth it yet.

## 6. Build and deploy order

1. Commit and push.
2. New build (native changes: permission strings, AlarmKit weak-linked, image picker removed):
   `eas build --platform ios --profile production` then `eas submit --platform ios --latest`.
3. Server: `./infra/deploy.sh staging …` first, then production (log scrubbing, request guards, Business routes off).
4. TestFlight check on the new build: unlock the test tools (Settings → tap the version line 7 times), run one demo night; check an iPhone on iOS 18 or earlier opens the app.
5. Submit for review with the notes above.
