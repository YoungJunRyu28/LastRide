import { Router, type IRouter } from "express";
import { GetNearbyPlacesQueryParams, GetNearbyPlacesResponse } from "@workspace/api-zod";

// Places to wait out the night are found on the device (Apple MapKit). The
// server has no free source for them, so it answers an empty list.
const router: IRouter = Router();

router.get("/places/nearby", (req, res) => {
  const parsed = GetNearbyPlacesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  res.json(GetNearbyPlacesResponse.parse([]));
});

export default router;
