# Japanese interface copy — editorial QA pass (2026-10-27)

## Scope and voice

The Japanese UI previously mixed literal English translations, casual filler,
developer terminology, and inconsistent labels for the same action. This patch
standardizes core mobile screens and server-generated group notifications:
onboarding, the ride/countdown screen, alternatives, destinations, groups,
group invitations, settings, premium cards, organizer and business screens,
notification messages, lock-screen widgets and Live Activities.

Prefer short, natural Japanese app language. Use familiar actions and concrete
outcomes rather than literal English UI phrases.

| UX concept | Preferred wording | Avoid |
| --- | --- | --- |
| Start tonight's active plan | 案内を開始 | 今夜スタート |
| Tracking while foregrounded | 位置情報を更新中 | トラッキング中 |
| Background option | アプリを閉じても更新 | 閉じても更新 (without app context) |
| Saved destinations | 帰る場所 | inconsistent 帰り先 / 行き先 / 帰宅先 in the same flow |
| Create and host | グループを作成 | 作る・ホスト |
| Active tonight | 今夜の共有中 | 今夜アクティブ |
| Last train missed | 終電を逃しましたか？ | 終電に間に合いませんでしたか？ (wordier) |
| Countdown | 出発まで | ここを出るまで |
| Reminders | 出発まであと15分 | あと15分 (ambiguous) |
| Additional time budget | 出発までの余裕時間 | 早めに出る時間 |
| Join state | 時刻を確認中 | 計算待ち |

Use 「出発」 when the PERSON leaves; use 「発」 or 「発車」 when
the TRAIN departs. Never imply the user will definitely catch a train based
on approximate routing, or that an unsupported push/notification is guaranteed.
Keep estimated walking and incomplete disruption-feed warnings conspicuous.
Do not translate a business or OS permission feature into a stronger promise.

## Validation performed

Mobile Vitest regression coverage (including notification strings, widget
labels, location disclosure, boarding and route status) and TypeScript
typechecks were rerun after copy changes. Group push message expectations were
updated with the server-side copy. No entitlement, API schema, credential,
tracking mode or release permission logic was intentionally changed.

## Required on-device Japanese QA before release

- Japanese iPhone and Android compact-width layouts: titles, CTA labels,
  long group names, multiline subtitles, native alert buttons, VoiceOver and
  TalkBack announcements, font scaling, dark and light mode.
- Interactive startup, notification and location-consent steps. Make sure
  the Japanese explanation matches actual OS behavior and the official
  Apple/Google permission wording.
- Confirm the business organizer, group hosts and members see consistent
  terms, particularly tonight's sharing vs permanent group membership.
- Signed-device notifications, Android notification channels, iOS Live
  Activities/Dynamic Island and lock-screen widgets: avoid clipping and
  confusing user departure times with train departure times.
- Terms, subscription cancellation, store disclosures, privacy and
  特定商取引法 pages require separate legal/operational confirmation; this
  editorial pass does not certify legal equivalence.
- A fluent Japanese product reviewer should proofread live screenshots
  against the actual product behavior; text-only review does not certify
  every rendered screen or third-party/native UI string.

Release status unchanged: see DEPLOYMENT-STOP-POINT.md for Stage 1
closed-beta and Stage 2 public-store launch gates.
