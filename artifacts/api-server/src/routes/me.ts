import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, type AuthedRequest, privateProfile } from "../lib/auth";
import { actCrime, actWork, actTrain, actHealPaid, actHealFree } from "../lib/game";

const router: IRouter = Router();

router.get("/me", authMiddleware, async (req: AuthedRequest, res) => {
  res.json({ user: privateProfile(req.user!) });
});

router.patch("/me", authMiddleware, async (req: AuthedRequest, res) => {
  const { bio, avatar } = req.body || {};
  const updates: Record<string, unknown> = {};
  if (typeof bio === "string") updates.bio = bio.slice(0, 280);
  if (typeof avatar === "string" && /^[a-z0-9-]{1,20}$/.test(avatar)) updates.avatar = avatar;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
  const updated = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.user!.id)).returning();
  res.json({ user: privateProfile(updated[0]!) });
});

router.post("/me/action", authMiddleware, async (req: AuthedRequest, res) => {
  const { type } = req.body || {};
  let result;
  switch (type) {
    case "crime": result = await actCrime(req.user!); break;
    case "work": result = await actWork(req.user!); break;
    case "train": result = await actTrain(req.user!); break;
    case "heal_paid": result = await actHealPaid(req.user!); break;
    case "heal_free": result = await actHealFree(req.user!); break;
    default: return res.status(400).json({ error: "Unknown action" });
  }
  res.json({ user: privateProfile(result.user), message: result.message, type: result.type, leveled: result.leveled });
});

export default router;
