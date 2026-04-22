import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import meRouter from "./me";
import playersRouter from "./players";
import missionsRouter from "./missions";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(meRouter);
router.use(playersRouter);
router.use(missionsRouter);
router.use(chatRouter);

export default router;
