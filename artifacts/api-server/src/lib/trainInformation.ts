/**
 * Live operation information (遅延・運転見合わせ) for the lines in a route,
 * from ODPT's odpt:TrainInformation for the operators the timetable engine
 * serves. Railway IDs are named the same way as the route legs
 * (timetableEngine.lineLabel), so the app can match them to a route.
 *
 * Optional for planning, not optional for truthfulness: a missing key,
 * malformed provider response or partial outage must not masquerade as
 * confirmed normal service. Callers can catch the typed unavailable error
 * and continue train planning with an explicit warning.
 */
import { logger } from "./logger";
import { providerTimeoutMs } from "./runtimeConfig";
import { LICENSED_OPERATORS, timetableEngine, type Railway } from "./timetableEngine";

const ODPT_BASE_URL = "https://api.odpt.org/api/v4";
/** ODPT refreshes operation information about every 5 minutes. */
const CACHE_MS = 60_000;

export class TrainInformationUnavailableError extends Error {
  constructor() {
    super("Live train disruption information unavailable");
    this.name = "TrainInformationUnavailableError";
  }
}

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
  if (!Array.isArray(body) || body.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new TrainInformationUnavailableError();
  }
  return body as OdptTrainInformation[];
}

let cached: { at: number; disruptions: TrainDisruption[] } | null = null;
let inflight: Promise<TrainDisruption[]> | null = null;

async function loadAll(): Promise<TrainDisruption[]> {
  const key = process.env.ODPT_KEY?.trim();
  if (!key) throw new TrainInformationUnavailableError();
  const { railways } = await timetableEngine();
  const results = await Promise.allSettled(
    LICENSED_OPERATORS.map((operator) => fetchOperator(operator, key)),
  );
  const items: OdptTrainInformation[] = [];
  let incomplete = false;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else {
      incomplete = true;
      logger.warn(
        {
          operator: LICENSED_OPERATORS[index],
          // Do not log fetch URLs, provider keys or raw response bodies.
          reason: result.reason instanceof Error ? result.reason.name : "unknown",
        },
        "ODPT train information unavailable for operator",
      );
    }
  });
  // Fail closed even when a different operator succeeded. An empty filtered
  // array must never claim every queried line is running normally when some
  // operators were unreachable.
  if (incomplete) throw new TrainInformationUnavailableError();
  return toDisruptions(items, railways);
}

/** Current disruptions on any of `lineNames` (route leg line names). */
export async function trainDisruptionsForLines(
  lineNames: string[],
): Promise<TrainDisruption[]> {
  if (lineNames.length === 0) return [];
  // Only operators present in the licensed snapshot have usable ODPT
  // disruption coverage. A JR/private line outside that set must never be
  // described as normal service merely because this provider has no entry.
  const { railways } = await timetableEngine();
  const supported = [...railways.values()].map((railway) => railway.nameJa);
  if (lineNames.some((line) => !supported.some((name) => disruptionMatchesLine(name, line)))) {
    throw new TrainInformationUnavailableError();
  }
  let all: TrainDisruption[];
  if (cached && Date.now() - cached.at < CACHE_MS) {
    all = cached.disruptions;
  } else {
    inflight ??= loadAll()
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
