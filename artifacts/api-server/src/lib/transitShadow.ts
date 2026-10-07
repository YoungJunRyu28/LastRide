import type { TrainRoute } from "./ekispert";
import { logger } from "./logger";
import {
  findStations,
  lastTrainBetween,
  readSnapshot,
  type JourneyAt,
} from "./transit/snapshot";
import type { TransitSnapshot } from "./transit/model";

type ShadowComparison = {
  providerHasRoute: boolean;
  shadowHasRoute: boolean;
  departureDeltaMinutes: number | null;
  arrivalDeltaMinutes: number | null;
  transferDelta: number | null;
};

let loadedPath: string | null = null;
let snapshotPromise: Promise<TransitSnapshot | null> | null = null;

export function normalizeServiceDate(date: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return null;
}

export function compareShadowRoutes(
  provider: TrainRoute | null,
  shadow: JourneyAt | null,
): ShadowComparison {
  return {
    providerHasRoute: provider !== null,
    shadowHasRoute: shadow !== null,
    departureDeltaMinutes:
      provider && shadow
        ? Math.round(
            (shadow.departsAt - Date.parse(provider.departsAt)) / 60_000,
          )
        : null,
    arrivalDeltaMinutes:
      provider && shadow
        ? Math.round(
            (shadow.arrivesAt - Date.parse(provider.arrivesAt)) / 60_000,
          )
        : null,
    transferDelta:
      provider && shadow ? shadow.transfers - provider.transfers : null,
  };
}

async function loadSnapshot(): Promise<TransitSnapshot | null> {
  const path = process.env.TRANSIT_SHADOW_SNAPSHOT_PATH?.trim();
  if (!path) return null;

  if (loadedPath !== path) {
    loadedPath = path;
    snapshotPromise = readSnapshot(path).catch((err) => {
      logger.warn(
        { errorName: err instanceof Error ? err.name : "Error" },
        "Transit shadow snapshot could not be loaded",
      );
      return null;
    });
  }
  return (snapshotPromise ??= Promise.resolve(null));
}

/**
 * Compare the own timetable engine against the provider for a last-train
 * request. This never changes the API response. Logs deliberately contain no
 * station names, coordinates, route legs or service date.
 */
export async function recordLastTrainShadowComparison(input: {
  fromName: string;
  toName: string;
  serviceDate: string;
  provider: TrainRoute | null;
}): Promise<void> {
  const snapshot = await loadSnapshot();
  if (!snapshot) return;

  const date = normalizeServiceDate(input.serviceDate);
  if (!date) return;
  const from = findStations(snapshot, input.fromName);
  const to = findStations(snapshot, input.toName);
  if (from.length === 0 || to.length === 0) return;

  const shadow = lastTrainBetween(snapshot, date, from, to);
  const comparison = compareShadowRoutes(input.provider, shadow);
  logger.info(
    { component: "transit-shadow", ...comparison },
    "Transit shadow last-train comparison",
  );
}
