import { Router, type IRouter } from "express";
import { SearchAddressesQueryParams, SearchAddressesResponse } from "@workspace/api-zod";

// Addresses are geocoded on the device (Apple MapKit). The server has no free
// source for them, so it answers an empty list.
const router: IRouter = Router();

router.get("/addresses/search", (req, res) => {
  const parsed = SearchAddressesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", issues: parsed.error.issues });
    return;
  }
  res.json(SearchAddressesResponse.parse([]));
});

export default router;
