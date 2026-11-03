import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getPool } from "@workspace/db";
import { timetableEngine } from "../lib/timetableEngine";

const READY_CACHE_MS = 60_000;
let lastDatabaseOk = -Infinity;

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

router.get("/readyz", async (req, res) => {
  const missing = ["DATABASE_URL"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    req.log.warn({ missing }, "Readiness check missing required configuration");
    res.status(503).json(HealthCheckResponse.parse({ status: "not-ready" }));
    return;
  }

  // Train times come from the bundled timetable snapshot; a deploy without a
  // readable one must not take traffic (the canary hook checks /readyz).
  try {
    await timetableEngine();
  } catch {
    res.status(503).json(HealthCheckResponse.parse({ status: "not-ready" }));
    return;
  }

  // Public and unauthenticated: a good answer is reused for a minute, so polling
  // it can't keep the scale-to-zero database awake (deploy hooks need one check).
  if (Date.now() - lastDatabaseOk < READY_CACHE_MS) {
    res.json(HealthCheckResponse.parse({ status: "ready" }));
    return;
  }
  try {
    await getPool().query("select 1");
    lastDatabaseOk = Date.now();
    res.json(HealthCheckResponse.parse({ status: "ready" }));
  } catch (err) {
    req.log.error({ err }, "Readiness database check failed");
    res.status(503).json(HealthCheckResponse.parse({ status: "not-ready" }));
  }
});

export default router;
