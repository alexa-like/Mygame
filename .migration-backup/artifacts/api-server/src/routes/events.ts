import { Router, type IRouter } from "express";
import { authMiddleware, type AuthedRequest } from "../lib/auth";
import { listEvents } from "../lib/events";

const router: IRouter = Router();

router.get("/events", authMiddleware, async (req: AuthedRequest, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
  const rows = await listEvents(req.user!.id, limit);
  res.json({ events: rows });
});

export default router;
