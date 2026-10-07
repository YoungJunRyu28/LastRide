# LastRide's own last-train engine

LastRide normally asks a provider for "the last train from A to B". Timetable
search from the commercial providers (駅すぱあと, NAVITIME, ジョルダン) is
licensed separately and is expensive, so this engine answers the same question
from raw timetables we can hold ourselves: ODPT open data today, and
nationwide GTFS (e.g. 交通新聞社) later.

It is **not yet allowed to serve API answers**. It can, however, run in
optional shadow mode beside Ekispert so we can measure accuracy before any
traffic switch. Without a configured shadow snapshot the running server does
nothing differently.

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

Tests: `tests/transit.test.ts`, `tests/transitImporters.test.ts` and `tests/transitShadow.test.ts`.

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

## Shadow mode against Ekispert

Set `TRANSIT_SHADOW_SNAPSHOT_PATH` on a development or staging API server to
the path of a built `.json.gz` snapshot. Each last-train request still returns
the Ekispert answer, but the server also evaluates the same named origin and
destination with LastRide's engine when both stations exist in the snapshot.

The comparison log contains only:

- whether each engine found a route;
- departure-time delta in minutes;
- arrival-time delta in minutes;
- transfer-count delta.

It deliberately does **not** log station names, coordinates, route legs,
destination, or service date. A missing/malformed snapshot or a station outside
the open-data coverage never changes the user response.

Use staging shadow results to build a route/date regression corpus before
enabling this engine as a serving provider.

## Before using it in production

1. **Licences and notices.** Use only the operators in the table above, and
   show the notices their licences require in the app (data source, no
   accuracy guarantee, contact, Toei credit). Re-check the catalogue when
   adding operators.
2. **Accuracy.** While the 駅すぱあと evaluation key works (to end of November
   2026), compare the engine with it on 20–30 real routes, weekday and
   weekend. Watch interchange times at big stations; `transfers.ts` estimates
   them from distance.
3. **Coverage.** ODPT covers the Tokyo area only. Outside it, the app needs
   another source or an "area not supported" message.
4. **Wiring.** Load the snapshot at server start (from S3 or the deployment
   bundle), serve `/api/trains` from `lastTrainBetween` behind a feature
   switch, and rebuild the snapshot on a schedule (timetables change, usually
   in March).
