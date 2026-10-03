import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getPool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

router.get("/readyz", async (req, res) => {
  const missing = ["DATABASE_URL", "EKISPERT_KEY", "RAPIDAPI_KEY"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    req.log.warn({ missing }, "Readiness check missing required configuration");
    res.status(503).json(HealthCheckResponse.parse({ status: "not-ready" }));
    return;
  }

  try {
    await getPool().query("select 1");
    res.json(HealthCheckResponse.parse({ status: "ready" }));
  } catch (err) {
    req.log.error({ err }, "Readiness database check failed");
    res.status(503).json(HealthCheckResponse.parse({ status: "not-ready" }));
  }
});

export default router;
