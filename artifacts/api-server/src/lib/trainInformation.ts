/**
 * Live operation information (遅延・運転見合わせ) for the lines in a route,
 * from ODPT's odpt:TrainInformation for the operators the timetable engine
 * serves. Railway IDs are named the same way as the route legs
 * (timetableEngine.lineLabel), so the app can match them to a route.
 *
 * Optional by design: no ODPT_KEY, an ODPT outage or a missing snapshot gives
 * an empty list, never an error, so planning never depends on it.
 */
import { logger } from "./logger";
import { providerTimeoutMs } from "./runtimeConfig";
import { LICENSED_OPERATORS, timetableEngine, type Railway } from "./timetableEngine";

const ODPT_BASE_URL = "https://api.odpt.org/api/v4";
/** ODPT refreshes operation information about every 5 minutes. */
const CACHE_MS = 60_000;

export type TrainDisruption = {
  line: string;
  lineCode: string | null;
  status: string;
  title: string;
  comment: string | null;
  updatedAt: string | null;
};

type Localized = { ja?: string; en?: string };
type OdptTrainInformation = {
  "odpt:railway"?: string;
  "odpt:operator"?: string;
  "dc:date"?: string;
  /** Present only when service is not normal. */
  "odpt:trainInformationStatus"?: Localized;
  "odpt:trainInformationText"?: Localized;
  "odpt:trainInformationCause"?: Localized;
};

export function normalizeRailLineName(name: string): string {
  return name
    .split("・")[0]
    .replace(/[\s　]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(外回り|内回り)$/u, "")
    .toLowerCase();
}

export function disruptionMatchesLine(
  disruptionLine: string,
  requestedLine: string,
): boolean {
  const disruption = normalizeRailLineName(disruptionLine);
  const requested = normalizeRailLineName(requestedLine);
  if (!disruption || !requested) return false;
  return (
    disruption === requested ||
    disruption.includes(requested) ||
    requested.includes(disruption)
  );
}

/** ODPT items → disruptions. Items without a status are normal service. */
export function toDisruptions(
  items: OdptTrainInformation[],
  railways: Map<string, Railway>,
): TrainDisruption[] {
  const disruptions: TrainDisruption[] = [];
  for (const item of items) {
    const status = item["odpt:trainInformationStatus"];
    const statusText = status?.ja ?? status?.en;
    if (!statusText || /平常/.test(statusText)) continue;
    const railwayId = item["odpt:railway"];
    const railway = railwayId ? railways.get(railwayId) : undefined;
    if (!railway) continue;
    const text = item["odpt:trainInformationText"];
    const cause = item["odpt:trainInformationCause"];
    disruptions.push({
      line: railway.nameJa,
      lineCode: railwayId ?? null,
      status: statusText,
      title: cause?.ja ? `${statusText}（${cause.ja}）` : statusText,
      comment: text?.ja ?? text?.en ?? null,
      updatedAt: item["dc:date"] ?? null,
    });
  }
  return disruptions;
}

async function fetchOperator(
  operator: string,
  key: string,
): Promise<OdptTrainInformation[]> {
  const url = new URL(`${ODPT_BASE_URL}/odpt:TrainInformation`);
  url.searchParams.set("odpt:operator", operator);
  url.searchParams.set("acl:consumerKey", key);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(providerTimeoutMs()),
  });
  // Never log the URL: it carries the key.
  if (!response.ok) throw new Error(`ODPT responded ${response.status}`);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as OdptTrainInformation[]) : [];
}

let cached: { at: number; disruptions: TrainDisruption[] } | null = null;
let inflight: Promise<TrainDisruption[]> | null = null;

async function loadAll(): Promise<TrainDisruption[]> {
  const key = process.env.ODPT_KEY?.trim();
  if (!key) return [];
  const { railways } = await timetableEngine();
  const results = await Promise.allSettled(
    LICENSED_OPERATORS.map((operator) => fetchOperator(operator, key)),
  );
  const items: OdptTrainInformation[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else
      logger.info(
        {
          operator: LICENSED_OPERATORS[index],
          err: (result.reason as Error).message,
        },
        "ODPT train information unavailable",
      );
  });
  return toDisruptions(items, railways);
}

/** Current disruptions on any of `lineNames` (route leg line names). */
export async function trainDisruptionsForLines(
  lineNames: string[],
): Promise<TrainDisruption[]> {
  if (lineNames.length === 0) return [];
  let all: TrainDisruption[];
  if (cached && Date.now() - cached.at < CACHE_MS) {
    all = cached.disruptions;
  } else {
    inflight ??= loadAll()
      .catch((err: unknown) => {
        logger.info(
          { err: (err as Error).message },
          "Train disruption information unavailable",
        );
        return [];
      })
      .then((disruptions) => {
        cached = { at: Date.now(), disruptions };
        return disruptions;
      })
      .finally(() => {
        inflight = null;
      });
    all = await inflight;
  }
  return all.filter((incident) =>
    lineNames.some((line) => disruptionMatchesLine(incident.line, line)),
  );
}

/** Tests only. */
export function resetTrainInformationCache(): void {
  cached = null;
  inflight = null;
}
