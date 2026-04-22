import { Router, type IRouter } from "express";
import { authMiddleware, type AuthedRequest, privateProfile } from "../lib/auth";
import { generateMissions, completeMission, type Mission } from "../lib/game";

const router: IRouter = Router();

// Per-user mission cache (in-memory; refreshes every 2 minutes or when consumed)
const missionCache = new Map<string, { missions: Mission[]; expires: number }>();
const TTL = 2 * 60 * 1000;

function getMissions(userId: string, level: number): Mission[] {
  const cached = missionCache.get(userId);
  if (cached && cached.expires > Date.now() && cached.missions.length > 0) return cached.missions;
  const missions = generateMissions(level, 4);
  missionCache.set(userId, { missions, expires: Date.now() + TTL });
  return missions;
}

router.get("/missions", authMiddleware, (req: AuthedRequest, res) => {
  const u = req.user!;
  res.json({ missions: getMissions(u.id, u.level) });
});

router.post("/missions/refresh", authMiddleware, (req: AuthedRequest, res) => {
  const u = req.user!;
  missionCache.delete(u.id);
  res.json({ missions: getMissions(u.id, u.level) });
});

router.post("/missions/:id/complete", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const list = getMissions(u.id, u.level);
  const mission = list.find((m) => m.id === req.params.id);
  if (!mission) return res.status(404).json({ error: "Mission expired or not found" });
  const result = await completeMission(u, mission);
  // remove mission from cache after attempt (success or fail)
  const cached = missionCache.get(u.id);
  if (cached) {
    cached.missions = cached.missions.filter((m) => m.id !== mission.id);
    if (cached.missions.length === 0) missionCache.delete(u.id);
  }
  res.json({
    user: privateProfile(result.user),
    message: result.message,
    type: result.type,
    leveled: result.leveled,
    missions: getMissions(u.id, result.user.level),
  });
});

export default router;
