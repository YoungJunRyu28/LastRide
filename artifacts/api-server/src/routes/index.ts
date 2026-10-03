import { Router, type IRouter } from "express";
import healthRouter from "./health";
import addressesRouter from "./addresses";
import placesRouter from "./places";
import stationsRouter from "./stations";
import taxiRouter from "./taxi";
import trainsRouter from "./trains";
import usageRouter from "./usage";
import walkRouter from "./walk";
import enterpriseRouter from "./enterprise";
import { rateLimitMiddleware, requestAddress } from "../lib/rateLimit";

const router: IRouter = Router();

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const publicLookupLimiter = rateLimitMiddleware({
  limit: positiveIntEnv("PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE", 60),
  windowMs: 60_000,
  key: (req) => `public-lookup:${requestAddress(req)}`,
});

router.use(
  ["/trains", "/stations", "/taxi", "/addresses", "/places", "/walk"],
  publicLookupLimiter,
);

router.use(healthRouter);
router.use(trainsRouter);
router.use(stationsRouter);
router.use(taxiRouter);
router.use(addressesRouter);
router.use(placesRouter);
router.use(usageRouter);
router.use(walkRouter);
router.use(enterpriseRouter);

export default router;
