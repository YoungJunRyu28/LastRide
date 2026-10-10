import { Router, type IRouter } from "express";
import { GetTaxiEstimateQueryParams, GetTaxiEstimateResponse } from "@workspace/api-zod";
import { taxiEstimate } from "../lib/estimates";

// A straight-line estimate on the Tokyo-area meter (see lib/estimates.ts);
// iOS gets driving time from Apple MapKit on the device.
const router: IRouter = Router();

router.get("/taxi", (req, res) => {
  const parsed = GetTaxiEstimateQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const { fromLat, fromLon, toLat, toLon, startTime } = parsed.data;
  res.json(
    GetTaxiEstimateResponse.parse(
      taxiEstimate({ latitude: fromLat, longitude: fromLon }, { latitude: toLat, longitude: toLon }, startTime),
    ),
  );
});

export default router;
