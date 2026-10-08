# Mobility learning and missed-train recovery

## Production invariants

LastRide treats routing and learned human timing as separate systems.

1. Timetables, fares, and available transport combinations come from deterministic provider-backed routing.
2. Learning predicts human timing uncertainty: preparation latency, walking duration, and station-area-to-boarding time.
3. A learned prediction is never required for core routing. Missing network, sparse aggregate data, disabled sharing, or a corrupt local profile falls back to deterministic provider timing.
4. The recommended departure is always at least 10 minutes earlier than the learned required-time boundary.
5. "Cheapest" is used only when a provider returned a known fare. Unknown-fare routes never win the cheapest badge.

## Leave-time model

For a candidate last train:

```
required time =
  personalized walking
  + preparation / pack-up latency
  + station access / boarding time

recommended leave =
  train departure
  - required time
  - safety margin
```

The safety margin is at least 10 minutes and can be larger when the existing reliability rules require it.

### Walking

The provider walking time is the cold-start baseline. After at least five local completed outcomes, the device uses a conservative p90 personal walking ratio. Total ascent/descent can be derived from usable altitude samples and contributed as training features, but route-specific terrain is not used to move a future recommendation until a production terrain feature source is available.

### Preparation latency

The device measures the time from the leave recommendation to sustained movement. The model uses a p90 local preparation latency after enough observations. This intentionally captures both pack-up friction and the user's typical response delay.

### Station access

The station model measures the time from entering the station area to the confirmed/proxied boarding time. A brand-new user can use aggregate p90 station estimates without contributing data.

Aggregate fallback order:

1. station + line + same day type + ±1 hour;
2. station + line;
3. station;
4. conservative 3-minute baseline.

Privacy thresholds prevent tiny cohorts from being returned:

- station + line + context: at least 12 samples and 5 contributors;
- station + line: at least 20 samples and 8 contributors;
- station: at least 40 samples and 15 contributors.

Only high-confidence caught-train observations are eligible for shared station aggregates. Speed-based boarding inference is tentative and never finalizes a trip on its own. The aggregate dataset requires both a motion transition and explicit "Made it" confirmation; timetable-only confirmation is retained locally but excluded from the aggregate. To limit one installation's influence, each station-profile cohort uses at most its three most recent observations. Installation tokens are **not** proof of unique human identity; anti-Sybil checks and data-quality review remain rollout requirements.

## Privacy architecture

Mobility learning is off by default.

The server never receives a learning payload containing:

- home or destination address;
- trip origin coordinates;
- raw GPS samples or a route trace;
- an exact observation timestamp.

The device converts location signals to derived durations, distance, total ascent/descent, station/line public identifiers, a coarse JST hour bucket, day type, and confidence. Idempotency IDs contain no timestamp.

The device owns a random 256-bit installation token in SecureStore. The server stores only SHA-256(token). Deleting the contributor row cascades all observations. Shared observations are retained at most 365 days.

## Background location

Night tracking is user initiated and has an explicit prominent disclosure before background permission is requested. A user can choose foreground-only tracking instead. The background task ends after the night's reminders/check-in or at the hard stop. Opting out discards the active learning session and unsent observations. Remote deletion first disables collection; if offline, the same token remains available for a future deletion retry.

When mobility learning is enabled, tracking requests finer sampling so movement/station boundaries can be inferred. When it is disabled, LastRide keeps the lower-power routing cadence.

iOS can suspend or coalesce background updates and underground GPS may be unavailable. The explicit caught/missed confirmation is therefore the authoritative fallback label.

## Missed-train recovery

The recovery screen compares:

- fare-ranked train/bus/walk routes that are still running;
- bounded train-partway + taxi cutovers;
- full taxi;
- walking when feasible;
- waiting/staying nearby for the first train.

Public-transit recovery uses Ekispert's departure search with buses enabled and fare ordering. The client removes known-fare routes that are simultaneously no cheaper, no faster, and no easier to walk than another route.

Train + taxi evaluates every bounded intermediate candidate instead of assuming that the farthest reachable station is cheapest.

The UI does **not** claim a global all-mode optimum: arbitrary bus-to-taxi cutovers are not exhaustively enumerated yet.

## Rollout gates

Before enabling the feature in a production store release:

- apply the mobility-learning database migration;
- configure production Ekispert/NAVITIME credentials and quotas;
- smoke-test recovery routing in Japan with a real provider key;
- test background tracking on physical iPhone and Android devices, including locked-screen use;
- test a major interchange (for example Shibuya/Shinjuku) and a small station;
- complete Google Play background-location permission declaration, prominent-disclosure evidence, and Data Safety answers;
- complete App Store privacy disclosures and review notes for background location and external transit providers;
- verify server retention maintenance and contributor deletion in staging;
- confirm alerts/metrics for learning endpoint error rate, aggregate query latency, suspicious-contributor volume, and provider failures;
- validate the station access model against labeled platform-entry/boarding timing in Japan; unverified station-center GPS crossing is not a ground-truth platform arrival;
- complete safeguards for coordinated fabricated submissions; opt-in installation tokens alone do not prevent attackers inventing multiple contributors.

## Model evolution

The current production-safe learner is an empirical conservative model: aggregate p90 station cohorts plus on-device personal p90 residuals. It is deliberately deployable before a large training corpus exists.

When enough consented data exists, train a versioned offline model (for example quantile gradient-boosted trees) on the same derived feature contract. Deploy it first in shadow mode and require it to beat the empirical baseline on catch-rate calibration and timing error before it is allowed to affect recommendations.
