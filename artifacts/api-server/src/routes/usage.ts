import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { GetUsageResponse } from "@workspace/api-zod";
import { usageReport } from "../lib/usage";

const router: IRouter = Router();

function hasAdminToken(req: Request, expected: string): boolean {
  const header = req.header("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const candidate = match?.[1]?.trim() ?? "";
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

router.get("/usage", async (req, res) => {
  const adminToken = process.env.USAGE_ADMIN_TOKEN?.trim();
  if (!adminToken && process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "Usage administration is not configured" });
    return;
  }
  if (adminToken && !hasAdminToken(req, adminToken)) {
    res.status(401).json({ error: "Administrator authentication required" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(GetUsageResponse.parse(await usageReport()));
});

export default router;
