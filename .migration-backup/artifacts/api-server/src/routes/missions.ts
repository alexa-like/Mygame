import { Router, type IRouter } from "express";
import { authMiddleware, type AuthedRequest, privateProfile } from "../lib/auth";
import { listAvailableMissions, refreshMissions, startMission, claimMission, abortMission } from "../lib/missions";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/missions", authMiddleware, async (req: AuthedRequest, res) => {
  const missions = await listAvailableMissions(req.user!);
  res.json({ missions });
});

router.post("/missions/refresh", authMiddleware, async (req: AuthedRequest, res) => {
  const missions = await refreshMissions(req.user!);
  res.json({ missions });
});

router.post("/missions/:id/start", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await startMission(req.user!, req.params.id!);
  if ("error" in r) return res.status(400).json({ error: r.error });
  // refetch the user
  const fresh = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const ms = await listAvailableMissions(fresh[0]!);
  res.json({ user: privateProfile(fresh[0]!), missions: ms, message: `Mission started.`, type: "info" });
});

router.post("/missions/:id/claim", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await claimMission(req.user!, req.params.id!);
  if ("error" in r) return res.status(400).json({ error: r.error });
  const ms = await listAvailableMissions(r.user);
  res.json({ user: privateProfile(r.user), message: r.message, type: r.success ? "reward" : "fail", leveled: r.leveled, missions: ms });
});

router.post("/missions/:id/abort", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await abortMission(req.user!, req.params.id!);
  if ("error" in r) return res.status(400).json({ error: r.error });
  const fresh = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const ms = await listAvailableMissions(fresh[0]!);
  res.json({ user: privateProfile(fresh[0]!), missions: ms, message: "Mission aborted.", type: "info" });
});

export default router;
