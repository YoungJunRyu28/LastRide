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
import groupsRouter from "./groups";
import { publicLookupLimiters } from "../lib/publicLookupLimiter";

const router: IRouter = Router();

// Count total per-IP traffic AND each lookup family separately. A group of
// genuine users behind one campus NAT can simultaneously request stations and
// trains without each endpoint consuming the others' entire allowance.
router.use(
  ["/trains", "/stations", "/taxi", "/addresses", "/places", "/walk"],
  ...publicLookupLimiters(),
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
router.use(groupsRouter);

export default router;
