import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetFirstTrainQueryParams,
  GetLastTrainQueryParams,
  GetLastTrainResponse,
  GetPartwayTrainTaxiQueryParams,
  GetPartwayTrainTaxiResponse,
  GetTrainDisruptionsQueryParams,
  GetTrainDisruptionsResponse,
} from "@workspace/api-zod";
import { findPartwayTrainTaxi } from "../lib/partway";
import { searchTrain, TimetableUnavailableError } from "../lib/timetableEngine";
import { trainDisruptionsForLines } from "../lib/trainInformation";

const router: IRouter = Router();

/** The snapshot is missing or unreadable (already logged by the engine). */
function timetableUnavailable(res: Response): void {
  res.status(503).json({ error: "Timetable unavailable" });
}

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
      // LastRide's own ODPT timetable engine. Stations it doesn't cover (JR,
      // private railways, outside Tokyo) answer 404, and the app asks Apple
      // Maps instead.
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
      if (!route) {
        res.status(404).json({
          error: "No train route between these stations on that date",
        });
        return;
      }
      res.json(GetLastTrainResponse.parse(route));
    } catch (err) {
      if (err instanceof TimetableUnavailableError) {
        timetableUnavailable(res);
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
    if (!(err instanceof TimetableUnavailableError)) throw err;
    timetableUnavailable(res);
  }
});

router.get("/trains/disruptions", async (req, res) => {
  const parsed = GetTrainDisruptionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const lines = parsed.data.lines
    .split(":")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  // ODPT odpt:TrainInformation for the engine's operators. Never fails: no
  // key or an ODPT outage gives [] so planning is unaffected.
  const incidents = await trainDisruptionsForLines(lines);
  res.json(GetTrainDisruptionsResponse.parse(incidents));
});

export default router;
