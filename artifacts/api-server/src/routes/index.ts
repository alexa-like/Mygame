import { Router, type IRouter } from "express";

import { healthRouter } from "./health";
import { authRouter } from "./auth";
import { meRouter } from "./me";
import { playersRouter } from "./players";
import { missionsRouter } from "./missions";
import { chatRouter } from "./chat";
import { tradeRouter } from "./trade";
import { adminRouter } from "./admin";
import { aiRouter } from "./ai";
import { bankRouter } from "./bank";
import { dailyRouter } from "./daily";
import { eventsRouter } from "./events";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(meRouter);
router.use(playersRouter);
router.use(missionsRouter);
router.use(chatRouter);
router.use(tradeRouter);
router.use(adminRouter);
router.use(aiRouter);
router.use(bankRouter);
router.use(dailyRouter);
router.use(eventsRouter);

export default router;
