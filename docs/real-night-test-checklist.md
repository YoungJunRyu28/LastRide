# Real-night test checklist

One line per run: date, station, what you did, what happened. Anything off → TestFlight log (設定 → テスト用 → ライブアクティビティの記録を見る) and a screenshot.

## Before going out
- [ ] Latest OTA is on the phone (runtime matches the build; reopen twice)
- [ ] Notifications, Live Activities and location ("Always") allowed
- [ ] Alarms on for one night and off for another

## Home screen (B2)
- [ ] First open: spinner card, then 「今夜は HH:MM に出る」 and the trip line
- [ ] Trip line opens the route (legs, fare)
- [ ] 終電 ▾: pick 1本前 / 2本前; the leave time and trip line change; panel closes
- [ ] Station ▾: この駅に固定 → lock icon on the chip; 自動に戻す; 駅を検索; switch to another station
- [ ] ↻ refreshes (greyed out for 30 s after a check)
- [ ] Large text (設定 → 画面表示 → 文字サイズ): nothing cut off

## 案内 (one run each)
| Run | Train | App during the night | Expect |
|---|---|---|---|
| A | 終電 | open in hand | ring counts down; reminders at their times; 停止 works |
| B | 終電 | closed, phone locked | reminders ≤ 20 s early, never late; Live Activity stays on |
| C | 1本前 | closed | 乗れましたか？ at departure; 〔乗った〕 ends the night |
| D | 1本前 | closed, don't answer | follow-up with the 終電 times |
| E | 終電 | walk to a different station | station switches only to the closest; widgets and Live Activity follow |
| F | any | stand still past the leave time | 出る時間です arrives; ring then counts to the train |

## Places
- [ ] Near home (no train needed message)
- [ ] Between two stations ~equal distance (山手 / 石川町 type): no flip-flopping
- [ ] Bus-stop names nearby (横浜本牧 type): never picked as a station
- [ ] Far from any station (> 5 km): far-station card, 帰り方

## After the last train
- [ ] 終電を逃しましたか？ arrives ~3 min after
- [ ] Home: time greyed, 「終電は発車しました」, 乗れなかったら opens
- [ ] Tracking switches itself off

## Groups (with a second phone)
- [ ] 今夜参加 from the home strip; other phone sees your leave time
- [ ] 停止 asks whether to stop sharing too
