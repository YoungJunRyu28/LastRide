import { Router, type IRouter } from "express";
import { GetUsageResponse } from "@workspace/api-zod";
import { usageReport } from "../lib/usage";

const router: IRouter = Router();

router.get("/usage", async (_req, res) => {
  res.json(GetUsageResponse.parse(await usageReport()));
});

export default router;
