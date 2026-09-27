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

const router: IRouter = Router();

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
