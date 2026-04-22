import { db, usersTable, missionsTable, type User, type MissionRow } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { applyLevelUps } from "./game";

const TEMPLATES = [
  { title: "Smuggle Chrome",          description: "Move a crate of black-market cyberware.",       difficulty: "medium" as const, energyCost: 18, durationSeconds: 90 },
  { title: "Decrypt a Datashard",      description: "Crack a stolen corporate datashard.",           difficulty: "easy"   as const, energyCost: 12, durationSeconds: 45 },
  { title: "Bodyguard a Fixer",        description: "Escort a fixer through gang territory.",       difficulty: "hard"   as const, energyCost: 25, durationSeconds: 180 },
  { title: "Bounty Hunt",              description: "Track down a deserter for the syndicate.",     difficulty: "hard"   as const, energyCost: 28, durationSeconds: 200 },
  { title: "Run Diagnostics",          description: "Help a ripperdoc test new neural ware.",       difficulty: "easy"   as const, energyCost: 8,  durationSeconds: 30 },
  { title: "Steal a Prototype",        description: "Lift an unreleased gadget from a lab.",        difficulty: "hard"   as const, energyCost: 22, durationSeconds: 160 },
  { title: "Deliver a Package",        description: "Quick run across the neon district.",          difficulty: "easy"   as const, energyCost: 10, durationSeconds: 35 },
  { title: "Sabotage a Server Farm",   description: "Plant a virus deep in a rival's data center.", difficulty: "hard"   as const, energyCost: 26, durationSeconds: 170 },
  { title: "Rescue a Netrunner",       description: "Pull a fried netrunner out of a dive bar.",    difficulty: "medium" as const, energyCost: 16, durationSeconds: 80 },
  { title: "Scout the Slums",          description: "Map gang territories for a journalist.",       difficulty: "easy"   as const, energyCost: 11, durationSeconds: 40 },
  { title: "Heist the Casino",         description: "Hit the high-roller floor at Crystal Sphere.", difficulty: "hard"   as const, energyCost: 30, durationSeconds: 240 },
  { title: "Translate Old Net Lore",   description: "Decode pre-collapse forum archives.",          difficulty: "easy"   as const, energyCost: 7,  durationSeconds: 25 },
];

const SUCCESS = { easy: 0.85, medium: 0.7, hard: 0.55 } as const;

function randPick<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function rewardsFor(t: typeof TEMPLATES[number], level: number) {
  const diffMul = t.difficulty === "easy" ? 1 : t.difficulty === "medium" ? 1.7 : 2.6;
  const lvlMul = 1 + level * 0.18;
  return {
    moneyReward: Math.floor((40 + Math.random() * 20) * diffMul * lvlMul),
    xpReward: Math.floor((10 + Math.random() * 5) * diffMul * (1 + level * 0.1)),
  };
}

export async function listAvailableMissions(user: User): Promise<MissionRow[]> {
  // Only return missions that aren't claimed (in progress or available or recently completed but not claimed)
  const rows = await db.select().from(missionsTable)
    .where(and(eq(missionsTable.userId, user.id), eq(missionsTable.claimed, false)));
  if (rows.length === 0) {
    // Generate a fresh slate of 4
    const picks = randPick(TEMPLATES, 4);
    const now = new Date();
    const inserts = picks.map((t) => {
      const r = rewardsFor(t, user.level);
      return {
        userId: user.id,
        title: t.title,
        description: t.description,
        difficulty: t.difficulty,
        energyCost: t.energyCost,
        durationSeconds: t.durationSeconds,
        moneyReward: r.moneyReward,
        xpReward: r.xpReward,
        status: "available",
        createdAt: now,
      };
    });
    const out = await db.insert(missionsTable).values(inserts).returning();
    return out;
  }
  return rows;
}

export async function refreshMissions(user: User): Promise<MissionRow[]> {
  // Delete only ones not in progress
  await db.delete(missionsTable).where(and(
    eq(missionsTable.userId, user.id),
    eq(missionsTable.claimed, false),
    ne(missionsTable.status, "in_progress"),
  ));
  return listAvailableMissions(user);
}

export async function startMission(user: User, missionId: string) {
  const rows = await db.select().from(missionsTable).where(and(eq(missionsTable.id, missionId), eq(missionsTable.userId, user.id))).limit(1);
  const m = rows[0];
  if (!m) return { error: "Mission not found." };
  if (m.status !== "available") return { error: "Mission already started." };
  if (user.energy < m.energyCost) return { error: `Need ${m.energyCost} energy.` };
  const completesAt = new Date(Date.now() + m.durationSeconds * 1000);
  await db.update(usersTable).set({ energy: user.energy - m.energyCost }).where(eq(usersTable.id, user.id));
  const updated = await db.update(missionsTable).set({
    status: "in_progress",
    startedAt: new Date(),
    completesAt,
  }).where(eq(missionsTable.id, missionId)).returning();
  return { ok: true, mission: updated[0]!, energySpent: m.energyCost };
}

export async function claimMission(user: User, missionId: string) {
  const rows = await db.select().from(missionsTable).where(and(eq(missionsTable.id, missionId), eq(missionsTable.userId, user.id))).limit(1);
  const m = rows[0];
  if (!m) return { error: "Mission not found." };
  if (m.claimed) return { error: "Already claimed." };
  if (m.status !== "in_progress") return { error: "Mission isn't running." };
  if (!m.completesAt || new Date(m.completesAt).getTime() > Date.now()) {
    return { error: "Mission isn't done yet." };
  }
  const success = Math.random() < (SUCCESS[m.difficulty as keyof typeof SUCCESS] ?? 0.6);
  let updatedUser = { ...user };
  let message: string;
  if (success) {
    updatedUser.money += m.moneyReward;
    updatedUser.xp += m.xpReward;
    updatedUser.missionsCompleted += 1;
    const before = updatedUser.level;
    updatedUser = applyLevelUps(updatedUser);
    await db.update(usersTable).set({
      money: updatedUser.money, xp: updatedUser.xp, level: updatedUser.level,
      maxHealth: updatedUser.maxHealth, maxEnergy: updatedUser.maxEnergy, maxNerve: updatedUser.maxNerve,
      health: updatedUser.health, energy: updatedUser.energy, nerve: updatedUser.nerve,
      missionsCompleted: updatedUser.missionsCompleted,
    }).where(eq(usersTable.id, user.id));
    await db.update(missionsTable).set({ status: "completed", claimed: true }).where(eq(missionsTable.id, missionId));
    message = `Mission "${m.title}" complete! +$${m.moneyReward}, +${m.xpReward} XP.`;
    return { ok: true, success: true, message, leveled: updatedUser.level > before, user: updatedUser };
  } else {
    const dmg = Math.floor(8 + Math.random() * (m.difficulty === "hard" ? 25 : m.difficulty === "medium" ? 18 : 10));
    updatedUser.health = Math.max(0, updatedUser.health - dmg);
    let extra = "";
    if (updatedUser.health <= 0) {
      updatedUser.health = 1;
      updatedUser.hospitalUntil = new Date(Date.now() + 60 * 1000);
      extra = " Hospitalized.";
    }
    await db.update(usersTable).set({
      health: updatedUser.health,
      hospitalUntil: updatedUser.hospitalUntil,
    }).where(eq(usersTable.id, user.id));
    await db.update(missionsTable).set({ status: "failed", claimed: true }).where(eq(missionsTable.id, missionId));
    message = `Mission "${m.title}" failed. -${dmg} HP.${extra}`;
    return { ok: true, success: false, message, leveled: false, user: updatedUser };
  }
}

export async function abortMission(user: User, missionId: string) {
  const rows = await db.select().from(missionsTable).where(and(eq(missionsTable.id, missionId), eq(missionsTable.userId, user.id))).limit(1);
  const m = rows[0];
  if (!m) return { error: "Mission not found." };
  if (m.status !== "in_progress") return { error: "Not in progress." };
  await db.update(missionsTable).set({ status: "failed", claimed: true }).where(eq(missionsTable.id, missionId));
  return { ok: true };
}
