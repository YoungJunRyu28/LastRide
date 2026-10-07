import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetFirstTrainQueryParams,
  GetLastTrainQueryParams,
  GetLastTrainResponse,
  GetPartwayTrainTaxiQueryParams,
  GetPartwayTrainTaxiResponse,
  GetRecoveryTransitRoutesQueryParams,
  GetRecoveryTransitRoutesResponse,
  GetTrainDisruptionsQueryParams,
  GetTrainDisruptionsResponse,
} from "@workspace/api-zod";
import { ProviderError } from "../lib/cache";
import { searchRecoveryTransitRoutes, searchTrain, trainDisruptionsForLines } from "../lib/ekispert";
import { findPartwayTrainTaxi } from "../lib/partway";
import { recordLastTrainShadowComparison } from "../lib/transitShadow";

const router: IRouter = Router();

function trainHandler(
  kind: "last" | "first",
  schema: typeof GetLastTrainQueryParams | typeof GetFirstTrainQueryParams,
) {
  return async (req: Request, res: Response) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid query", issues: parsed.error.issues });
      return;
    }
    const query = parsed.data;
    try {
      const route = await searchTrain(
        kind,
        {
          latitude: query.fromLat,
          longitude: query.fromLon,
          name: query.fromName,
        },
        { latitude: query.toLat, longitude: query.toLon, name: query.toName },
        query.date,
      );
      if (kind === "last") {
        await recordLastTrainShadowComparison({
          fromName: query.fromName,
          toName: query.toName,
          serviceDate: query.date,
          provider: route,
        }).catch((err) => {
          req.log.debug(
            { errorName: (err as Error).name },
            "Transit shadow comparison failed",
          );
        });
      }
      if (!route) {
        res.status(404).json({
          error: "No train route between these stations on that date",
        });
        return;
      }
      res.json(GetLastTrainResponse.parse(route));
    } catch (err) {
      if (err instanceof ProviderError) {
        req.log.warn({ err: err.message }, "Timetable provider unavailable");
        res.status(502).json({ error: "Timetable provider unavailable" });
        return;
      }
      throw err;
    }
  };
}

router.get("/trains/last", trainHandler("last", GetLastTrainQueryParams));
router.get("/trains/first", trainHandler("first", GetFirstTrainQueryParams));

router.get("/trains/partway", async (req, res) => {
  const parsed = GetPartwayTrainTaxiQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const query = parsed.data;
  try {
    const option = await findPartwayTrainTaxi({
      from: {
        latitude: query.fromLat,
        longitude: query.fromLon,
        name: query.fromName,
      },
      to: {
        latitude: query.toLat,
        longitude: query.toLon,
        name: query.toName,
      },
      taxiTo: {
        latitude: query.taxiToLat,
        longitude: query.taxiToLon,
      },
      serviceDate: query.date,
      earliestBoardAtMs: query.earliestBoardAtMs,
    });
    if (!option) {
      res.status(404).json({ error: "No useful partway train option remains" });
      return;
    }
    res.json(GetPartwayTrainTaxiResponse.parse(option));
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    req.log.warn({ err: err.message }, "Partway route provider unavailable");
    res
      .status(502)
      .json({ error: "Timetable or routing provider unavailable" });
  }
});


router.get("/trains/recovery-transit", async (req, res) => {
  const parsed = GetRecoveryTransitRoutesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }

  const query = parsed.data;
  try {
    const routes = await searchRecoveryTransitRoutes(
      { latitude: query.fromLat, longitude: query.fromLon },
      { latitude: query.toLat, longitude: query.toLon },
      query.earliestDepartureAtMs,
      query.limit,
    );
    res.json(GetRecoveryTransitRoutesResponse.parse(routes));
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    req.log.warn(
      { err: err.message },
      "Recovery public-transit provider unavailable",
    );
    res.status(502).json({ error: "Timetable provider unavailable" });
  }
});

export default router;

router.get("/trains/disruptions", async (req, res) => {
  const parsed = GetTrainDisruptionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  try {
    const lines = parsed.data.lines
      .split(":")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);
    const incidents = await trainDisruptionsForLines(lines);
    res.json(GetTrainDisruptionsResponse.parse(incidents));
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    // Operation information is an optional Ekispert product. A key without
    // that entitlement must never break the core last-train experience.
    req.log.info(
      { err: err.message },
      "Train disruption information unavailable",
    );
    res.json([]);
  }
});
