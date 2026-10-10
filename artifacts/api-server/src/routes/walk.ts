import { Router, type IRouter } from "express";
import { GetWalkRouteQueryParams, GetWalkRouteResponse } from "@workspace/api-zod";
import { walkEstimate } from "../lib/estimates";

// A straight-line estimate (× 1.3 at the pace's speed); iOS routes walks
// with Apple MapKit on the device.
const router: IRouter = Router();

router.get("/walk", (req, res) => {
  const parsed = GetWalkRouteQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  const { fromLat, fromLon, toLat, toLon, pace } = parsed.data;
  res.json(
    GetWalkRouteResponse.parse(
      walkEstimate({ latitude: fromLat, longitude: fromLon }, { latitude: toLat, longitude: toLon }, pace),
    ),
  );
});

export default router;
