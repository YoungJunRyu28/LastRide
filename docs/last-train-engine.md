# LastRide's own last-train engine

Timetable search from the commercial providers (駅すぱあと, NAVITIME,
ジョルダン) is licensed separately and is expensive, so LastRide answers "the
last train from A to B" from raw timetables it holds itself: ODPT open data
today, and nationwide GTFS (e.g. 交通新聞社) later if licensed.

**This engine serves the API's train endpoints** (`/api/trains/last`,
`/api/trains/first`, `/api/trains/partway`). Ekispert is no longer used. A
trip the engine doesn't cover (JR, private railways, outside Tokyo) answers
404, and the iOS app then asks Apple Maps on the phone.

## How it works

Code: `artifacts/api-server/src/lib/transit/`.

| File                | Role                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`          | The snapshot format: stations, services (calendars) and trips. Times are minutes after service-day midnight, so a 00:31 train is 24:31 on tonight's service day.                                                                                     |
| `services.ts`       | Which trips run on a date: weekday / Saturday / holiday timetables, using Japanese public holidays (`@holiday-jp/holiday_jp`), plus GTFS date ranges and exceptions.                                                                                 |
| `transfers.ts`      | Changing trains. Each operator's part of a station has its own ID, so same-named stations within 700 m are joined by a walk (at least 4 min, longer with distance). A change at one station ID takes 2 min.                                          |
| `csa.ts`            | The search (Connection Scan Algorithm). One reverse scan gives the latest departure from **every** station to the destination tonight, with the journey (trains, walks, through-running lines). A forward scan gives the first train in the morning. |
| `importers/odpt.ts` | ODPT JSON (odpt:Station, odpt:Railway, odpt:Calendar, odpt:TrainTimetable). Through-running trains (`odpt:nextTrainTimetable`) become one vehicle, so staying on board needs no change.                                                              |
| `importers/gtfs.ts` | GTFS / GTFS-JP (JR East publishes its timetable on ODPT in this format). Platforms merge into stations; English names come from `translations.txt`.                                                                                                  |
| `snapshot.ts`       | Writing and reading the gzipped snapshot, finding stations by name (Japanese or English), and `lastTrainBetween` / `firstTrainBetween` returning epoch times.                                                                                        |

Serving it: `src/lib/timetableEngine.ts` loads the snapshot once per process,
drops unlicensed operators, matches the app's stations and converts journeys
to the API's `TrainRoute`; `src/lib/partway.ts` (train partway + taxi, the
taxi being a straight-line estimate from `src/lib/estimates.ts`),
`src/lib/odptStations.ts` (`/api/stations/search` and `/api/stations/nearby`:
the snapshot's stations, so subway/licensed operators only) and
`src/lib/trainInformation.ts` (live operation information from ODPT
`odpt:TrainInformation`) build on it.

Tests: `tests/transit.test.ts`, `tests/transitImporters.test.ts`,
`tests/timetableEngine.test.ts`, `tests/partway.test.ts` and
`tests/trainsRoute.test.ts`.

## Building and querying a snapshot

Put your ODPT developer key in `artifacts/api-server/.env` as `ODPT_KEY`, then:

```bash
cd artifacts/api-server
set -a; . ./.env; set +a

# The licensed ODPT operators (see the table below).
pnpm run transit:build
# A GTFS feed you are licensed to use can be added with --gtfs "Name=<zip URL or path>".

pnpm run transit:last-train -- --from 渋谷 --to 押上
pnpm run transit:last-train -- --from Akihabara --to Tsukuba --date 2026-10-09 --en
```

`transit:build` prints how many trains it got per operator; an operator with
none is not in ODPT's public data dump.
The snapshot goes to `data/` (git-ignored: it is provider data).

## Serving it

- **Where the server finds the snapshot:** `TRANSIT_SNAPSHOT_PATH` (the old
  `TRANSIT_SHADOW_SNAPSHOT_PATH` still works), otherwise
  `transit-snapshot.json.gz` next to the server bundle (`dist/`), otherwise
  `data/transit-snapshot.json.gz` under the working directory. If none can be
  read, train endpoints answer 503, `/api/readyz` reports not-ready, and the
  error is logged.
- **Packaging:** `pnpm run build` (build.mjs) copies
  `data/transit-snapshot.json.gz` (or `TRANSIT_SNAPSHOT_PATH`) into `dist/`,
  which is the Lambda package. Without a snapshot it only warns, so CI builds
  work; `infra/deploy.sh` checks it exists and builds with
  `REQUIRE_TRANSIT_SNAPSHOT=1`, which fails the build if it is missing or
  unreadable. So **build the snapshot on the deploying machine before
  deploying.**
- **Keeping it current (automatic):** timetables change, most of all at the
  March timetable revision (ダイヤ改正), and the server refuses a snapshot
  more than 30 days old. `TransitRefreshFunction` (`src/transitRefresh.ts`,
  `infra/template.yaml`) rebuilds it from ODPT at 04:30 JST on the 1st and
  15th and stores it in the stage's S3 bucket (`lastride-<stage>-transit-<account>`,
  versioned). The API loads the newer of that and the bundled copy, and checks
  S3 again every 6 hours, so no redeploy is needed. A result missing an
  operator, or with far fewer trains or stations than the one in place, isn't
  published, and `TransitRefreshErrorsAlarm` emails the operations topic.
  `infra/deploy.sh` bundles the S3 copy when it's newer than the local file.
  To refresh now (after a ダイヤ改正, or the first time):
  `aws lambda invoke --function-name lastride-<stage>-transit-refresh /dev/stdout`.
  `pnpm run transit:build` still builds one locally (and can add GTFS feeds).
- **Licensing at load time:** `LICENSED_OPERATORS` in
  `src/lib/timetableEngine.ts` lists the operators from the table below that
  may be used commercially. Anything else in a snapshot is dropped when it is
  loaded: the current snapshot also contains Yurikamome's stations, which is
  not in the table and so is never served. Keep the constant and the table in
  step.
- **Matching stations:** the app's station names come from other sources, so
  the Japanese name is tried first (ignoring "駅" and bracketed alternate
  names) among stations within 2 km of the given coordinates, then the nearest
  snapshot station within 400 m, with the other operators' platforms of that
  station.
- **Answers:** line names get their operator in front (都営新宿線,
  東京メトロ半蔵門線, 横浜市営地下鉄ブルーライン), walks between operators'
  platforms are part of a change rather than a leg, and `fareYen` is always
  null (ODPT has no fares for these operators).
- **Operation information:** `/api/trains/disruptions` reads ODPT
  `odpt:TrainInformation` for the licensed operators with `ODPT_KEY`, cached
  for a minute; no key or an ODPT failure gives an empty list.

## What the data covers (checked October 2026)

| Operator                                                   | Trains  | Licence                                        | Usable commercially       |
| ---------------------------------------------------------- | ------- | ---------------------------------------------- | ------------------------- |
| Tokyo Metro                                                | ~10,000 | 公共交通オープンデータ基本ライセンス           | Yes, with notices         |
| Toei (subway)                                              | ~5,600  | CC BY 4.0                                      | Yes, with credit          |
| Tsukuba Express (MIR)                                      | ~840    | 基本ライセンス                                 | Yes, with notices         |
| Rinkai Line (TWR)                                          | ~560    | 基本ライセンス                                 | Yes, with notices         |
| Tama Monorail                                              | ~470    | 基本ライセンス                                 | Yes, with notices         |
| Yokohama Municipal Subway                                  | ~1,300  | 基本ライセンス                                 | Yes, with notices         |
| JR East, Tokyu, Odakyu, Keio, Keikyu, Seibu, Tobu, Sotetsu | —       | 公共交通オープンデータチャレンジ限定ライセンス | **No** (contest use only) |
| Yurikamome (in the snapshot, stations only)                | —       | not checked                                    | **No** until checked: dropped at load |

The Basic Licence allows commercial and non-commercial use on three
conditions. The app must show that the data comes from 公共交通オープンデータセンター,
that its accuracy and completeness are not guaranteed, and a contact for the
app (so users do not contact the rail companies). Toei's CC BY 4.0 data needs
a credit to 東京都交通局.

So without JR East and the private railways, the engine can serve trips made
entirely on the subways, TX, Rinkai, Tama Monorail and the Yokohama subway.
Most real trips home in Tokyo involve JR or a private railway at some point.
For those, the engine needs licensed data, from those operators directly or
nationwide from 交通新聞社, before it can stand on its own.

## Verified against 駅すぱあと

Last trains on the night of Friday 9 October 2026, engine vs 駅すぱあと's
last-train search:

| Route           | Engine        | 駅すぱあと    |                                      |
| --------------- | ------------- | ------------- | ------------------------------------ |
| 秋葉原 → つくば | 23:45 → 00:43 | 23:45 → 00:43 | same                                 |
| 横浜 → あざみ野 | 00:32 → 01:00 | 00:32 → 01:00 | same                                 |
| 渋谷 → 押上     | 00:07 → 00:39 | 00:07 → 00:39 | same                                 |
| 目黒 → 西高島平 | 23:40 → 00:33 | 23:40 → 00:33 | same                                 |
| 渋谷 → 池袋     | 00:08 → 00:24 | 00:33 → 00:54 | 駅すぱあと uses JR (not in the data) |
| 新木場 → 大崎   | 23:54 → 00:13 | 00:08 → 00:50 | 駅すぱあと uses JR                   |
| 中目黒 → 北千住 | 23:46 → 00:31 | 23:49 → 00:35 | 駅すぱあと uses Tokyu                |
| 大手町 → 西船橋 | 00:05 → 00:37 | 00:16 → 00:55 | 駅すぱあと uses JR                   |

Where both use the same operators the times match to the minute; every
difference is JR or a private railway that is missing from the data.

## Still to do

1. **Notices.** Show the notices the licences require in the app (data
   source 公共交通オープンデータセンター, no accuracy guarantee, app contact,
   Toei credit). Re-check the catalogue when adding operators.
2. **Accuracy.** The table above matches 駅すぱあと to the minute on the
   operators we have. Watch interchange times at big stations;
   `transfers.ts` estimates them from distance.
3. **Coverage.** ODPT covers the Tokyo area only, and without JR and the
   private railways; the app relies on Apple Maps (iOS) for everything else.
4. **Refresh.** Rebuilding the snapshot is manual (see "Serving it");
   automate it if timetable changes are missed.
