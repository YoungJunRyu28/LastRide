import { Router, type IRouter } from "express";
import {
  GetNearbyStationsQueryParams,
  GetNearbyStationsResponse,
  SearchStationsQueryParams,
  SearchStationsResponse,
} from "@workspace/api-zod";
import { nearbyStations, searchStations } from "../lib/odptStations";
import { TimetableUnavailableError } from "../lib/timetableEngine";

// Answered from the ODPT timetable snapshot (licensed operators only; JR and
// private railways are not covered). iOS uses Apple MapKit on the device.
const router: IRouter = Router();

router.get("/stations/nearby", async (req, res) => {
  const parsed = GetNearbyStationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const { lat, lon, pace, limit } = parsed.data;
  try {
    res.json(GetNearbyStationsResponse.parse(await nearbyStations(lat, lon, pace, limit ?? 5)));
  } catch (err) {
    if (!(err instanceof TimetableUnavailableError)) throw err;
    req.log.warn({ err: err.message }, "Station data unavailable");
    res.status(502).json({ error: "Station provider unavailable" });
  }
});

router.get("/stations/search", async (req, res) => {
  const parsed = SearchStationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  try {
    res.json(SearchStationsResponse.parse(await searchStations(parsed.data.q)));
  } catch (err) {
    if (!(err instanceof TimetableUnavailableError)) throw err;
    req.log.warn({ err: err.message }, "Station data unavailable");
    res.status(502).json({ error: "Station provider unavailable" });
  }
});

export default router;
