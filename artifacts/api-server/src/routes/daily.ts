import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, privateProfile, type AuthedRequest } from "../lib/auth";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dailyStatusFor(u: { lastDailyClaimAt: Date | null; dailyStreak: number }) {
  const now = Date.now();
  const last = u.lastDailyClaimAt ? new Date(u.lastDailyClaimAt).getTime() : 0;
  const ready = !last || now - last >= ONE_DAY_MS;
  const nextAt = last ? new Date(last + ONE_DAY_MS).toISOString() : null;
  return { ready, nextAt, streak: u.dailyStreak };
}

router.get("/daily", authMiddleware, (req: AuthedRequest, res) => {
  res.json(dailyStatusFor(req.user!));
});

router.post("/daily/claim", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const now = Date.now();
  const last = u.lastDailyClaimAt ? new Date(u.lastDailyClaimAt).getTime() : 0;
  if (last && now - last < ONE_DAY_MS) {
    const waitMs = ONE_DAY_MS - (now - last);
    return res.status(409).json({ error: `Daily reward not ready. Try again in ${Math.ceil(waitMs / 60000)} min.` });
  }
  // If they claimed within 48h, streak continues; otherwise resets to 1.
  const continued = last && (now - last) < 2 * ONE_DAY_MS;
  const newStreak = continued ? u.dailyStreak + 1 : 1;
  const cappedStreak = Math.min(30, newStreak);
  const moneyReward = 200 + cappedStreak * 50;       // $250 day1 → $1700 at 30
  const xpReward = 10 + cappedStreak * 2;
  const energyBonus = 25;
  const updated = await db.update(usersTable).set({
    money: u.money + moneyReward,
    xp: u.xp + xpReward,
    energy: Math.min(u.maxEnergy, u.energy + energyBonus),
    dailyStreak: newStreak,
    lastDailyClaimAt: new Date(),
  }).where(eq(usersTable.id, u.id)).returning();
  await logEvent(u.id, "daily", `Daily reward claimed (streak ${newStreak}): +$${moneyReward}, +${xpReward} XP, +${energyBonus} energy.`, moneyReward, { streak: newStreak });
  res.json({
    user: privateProfile(updated[0]!),
    rewards: { money: moneyReward, xp: xpReward, energy: energyBonus, streak: newStreak },
  });
});

export default router;
