import { Router, type IRouter, type Request } from "express";
import { isDatabaseConfigured } from "@workspace/db";
import {
  CURRENT_LEARNING_CONSENT_VERSION,
  deleteContributorLearningData,
  hashLearningToken,
  recordMobilityObservations,
  stationAccessProfiles,
  validLearningToken,
  type MobilityObservationInput,
  type StationAccessProfileQuery,
} from "../lib/mobilityLearning";
import { rateLimitMiddleware, requestAddress } from "../lib/rateLimit";

const router: IRouter = Router();
const MAX_BATCH_SIZE = 20;
const MAX_PROFILE_QUERIES = 12;

function learningToken(req: Request): string | null {
  const token = req.header("x-learning-token")?.trim() ?? "";
  return validLearningToken(token) ? token : null;
}

const uploadLimiter = rateLimitMiddleware({
  limit: 30,
  windowMs: 60_000,
  key: (req) => {
    const token = learningToken(req);
    return token
      ? `learning-upload:${hashLearningToken(token)}`
      : `learning-upload-ip:${requestAddress(req)}`;
  },
});

const profileLimiter = rateLimitMiddleware({
  limit: 60,
  windowMs: 60_000,
  key: (req) => `learning-profile:${requestAddress(req)}`,
});

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

const OBSERVATION_KEYS = [
  "clientObservationId",
  "kind",
  "stationKey",
  "lineKey",
  "hourBucket",
  "dayType",
  "packupSeconds",
  "walkingDistanceMeters",
  "providerWalkingSeconds",
  "actualWalkingSeconds",
  "elevationGainMeters",
  "elevationLossMeters",
  "stationTraversalSeconds",
  "caughtTrain",
  "confidencePermille",
  "modelVersion",
] as const;

function parseObservation(value: unknown): MobilityObservationInput | null {
  const raw = object(value);
  if (!raw || !exactKeys(raw, OBSERVATION_KEYS)) return null;

  const clientObservationId = optionalText(raw.clientObservationId, 80);
  const kind =
    raw.kind === "trip_timing" || raw.kind === "station_traversal"
      ? raw.kind
      : null;
  const stationKey = optionalText(raw.stationKey, 180);
  const lineKey = optionalText(raw.lineKey, 180);
  const hourBucket = boundedInteger(raw.hourBucket, 0, 23);
  const dayType =
    raw.dayType === "weekday" ||
    raw.dayType === "weekend" ||
    raw.dayType === "holiday"
      ? raw.dayType
      : null;
  const confidencePermille = boundedInteger(raw.confidencePermille, 0, 1000);
  const modelVersion = optionalText(raw.modelVersion, 40);

  if (
    !clientObservationId ||
    !kind ||
    hourBucket === undefined ||
    !dayType ||
    confidencePermille === undefined ||
    !modelVersion
  ) {
    return null;
  }

  if (
    raw.caughtTrain !== undefined &&
    raw.caughtTrain !== null &&
    typeof raw.caughtTrain !== "boolean"
  ) {
    return null;
  }

  const fields = {
    packupSeconds: boundedInteger(raw.packupSeconds, 0, 3600),
    walkingDistanceMeters: boundedInteger(raw.walkingDistanceMeters, 0, 50_000),
    providerWalkingSeconds: boundedInteger(raw.providerWalkingSeconds, 0, 14_400),
    actualWalkingSeconds: boundedInteger(raw.actualWalkingSeconds, 0, 14_400),
    elevationGainMeters: boundedInteger(raw.elevationGainMeters, 0, 5000),
    elevationLossMeters: boundedInteger(raw.elevationLossMeters, 0, 5000),
    stationTraversalSeconds: boundedInteger(raw.stationTraversalSeconds, 0, 1800),
  };

  for (const [key, parsed] of Object.entries(fields)) {
    if (raw[key] !== undefined && raw[key] !== null && parsed === undefined) {
      return null;
    }
  }

  if (
    kind === "station_traversal" &&
    (!stationKey || fields.stationTraversalSeconds === undefined)
  ) {
    return null;
  }

  return {
    clientObservationId,
    kind,
    stationKey,
    lineKey,
    hourBucket,
    dayType,
    ...fields,
    caughtTrain:
      typeof raw.caughtTrain === "boolean" ? raw.caughtTrain : undefined,
    confidencePermille,
    modelVersion,
  };
}

function parseProfileQuery(value: unknown): StationAccessProfileQuery | null {
  const raw = object(value);
  if (!raw || !exactKeys(raw, ["stationKey", "lineKey", "hourBucket", "dayType"])) return null;
  const stationKey = optionalText(raw.stationKey, 180);
  const lineKey = optionalText(raw.lineKey, 180);
  const hourBucket = boundedInteger(raw.hourBucket, 0, 23);
  const dayType =
    raw.dayType === "weekday" || raw.dayType === "weekend" || raw.dayType === "holiday"
      ? raw.dayType
      : null;
  return stationKey && hourBucket !== undefined && dayType
    ? { stationKey, lineKey, hourBucket, dayType }
    : null;
}

router.post("/learning/observations", uploadLimiter, async (req, res) => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({ error: "Learning service unavailable" });
    return;
  }
  const token = learningToken(req);
  if (!token) {
    res.status(401).json({ error: "Learning token required" });
    return;
  }

  const body = object(req.body);
  if (!body || !exactKeys(body, ["consentVersion", "observations"])) {
    res.status(400).json({ error: "Invalid learning observation batch" });
    return;
  }
  const consentVersion = body.consentVersion;
  const rawObservations = body?.observations;
  if (
    consentVersion !== CURRENT_LEARNING_CONSENT_VERSION ||
    !Array.isArray(rawObservations) ||
    rawObservations.length < 1 ||
    rawObservations.length > MAX_BATCH_SIZE
  ) {
    res.status(400).json({ error: "Invalid learning observation batch" });
    return;
  }

  const observations = rawObservations.map(parseObservation);
  if (observations.some((observation) => observation === null)) {
    res.status(400).json({ error: "Invalid learning observation" });
    return;
  }

  const result = await recordMobilityObservations(
    token,
    consentVersion,
    observations as MobilityObservationInput[],
  );
  res.status(202).json(result);
});

router.post(
  "/learning/station-profiles",
  profileLimiter,
  async (req, res) => {
    if (!isDatabaseConfigured()) {
      res.status(503).json({ error: "Learning service unavailable" });
      return;
    }
    const body = object(req.body);
    if (!body || !exactKeys(body, ["queries"])) {
      res.status(400).json({ error: "Invalid station profile query" });
      return;
    }
    const rawQueries = body.queries;
    if (
      !Array.isArray(rawQueries) ||
      rawQueries.length < 1 ||
      rawQueries.length > MAX_PROFILE_QUERIES
    ) {
      res.status(400).json({ error: "Invalid station profile query" });
      return;
    }
    const queries = rawQueries.map(parseProfileQuery);
    if (queries.some((query) => query === null)) {
      res.status(400).json({ error: "Invalid station profile query" });
      return;
    }
    res.json(
      await stationAccessProfiles(queries as StationAccessProfileQuery[]),
    );
  },
);

router.delete("/learning/contributor", uploadLimiter, async (req, res) => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({ error: "Learning service unavailable" });
    return;
  }
  const token = learningToken(req);
  if (!token) {
    res.status(401).json({ error: "Learning token required" });
    return;
  }
  await deleteContributorLearningData(token);
  res.status(204).end();
});

export default router;
