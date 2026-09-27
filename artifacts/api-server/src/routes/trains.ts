import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetFirstTrainQueryParams,
  GetLastTrainQueryParams,
  GetLastTrainResponse,
  GetPartwayTrainTaxiQueryParams,
  GetPartwayTrainTaxiResponse,
} from "@workspace/api-zod";
import { ProviderError } from "../lib/cache";
import { searchTrain } from "../lib/ekispert";
import { findPartwayTrainTaxi } from "../lib/partway";

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
      if (!route) {
        res
          .status(404)
          .json({
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

export default router;
