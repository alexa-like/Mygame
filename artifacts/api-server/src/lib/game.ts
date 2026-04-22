import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";

export function xpForNext(level: number): number {
  return Math.round(50 * Math.pow(1.5, level - 1));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function applyLevelUps(user: User): User {
  let u = { ...user };
  while (u.xp >= xpForNext(u.level)) {
    u.xp -= xpForNext(u.level);
    u.level += 1;
    u.maxHealth += 10;
    u.maxEnergy += 5;
    u.health = u.maxHealth;
    u.energy = u.maxEnergy;
  }
  return u;
}

export interface ActionResult {
  user: User;
  message: string;
  type: "success" | "fail" | "info" | "reward" | "levelup";
  leveled: boolean;
}

const CRIMES = [
  "pickpocketing a corpo suit",
  "hacking an ATM",
  "boosting a hover-bike",
  "running a data heist",
  "shaking down a vendor",
  "raiding a back-alley clinic",
];

export async function actCrime(user: User): Promise<ActionResult> {
  if (user.energy < 10) return { user, message: "Not enough energy.", type: "fail", leveled: false };
  let u = { ...user, energy: user.energy - 10 };
  const crime = CRIMES[Math.floor(Math.random() * CRIMES.length)];
  const successChance = 0.55 + Math.min(0.25, u.level * 0.02);
  const success = Math.random() < successChance;
  let msg = "";
  let type: ActionResult["type"] = "info";
  if (success) {
    const reward = Math.floor((20 + Math.random() * 60) * (1 + u.level * 0.2));
    const xpGain = Math.floor(10 + Math.random() * 15 + u.level * 2);
    u.money += reward;
    u.xp += xpGain;
    u.crimesCommitted += 1;
    msg = `Pulled off ${crime}. +$${reward}, +${xpGain} XP.`;
    type = "success";
  } else {
    const dmg = Math.floor(8 + Math.random() * 18);
    u.health = clamp(u.health - dmg, 0, u.maxHealth);
    msg = `Got burned ${crime}. -${dmg} HP.`;
    type = "fail";
    if (u.health <= 0) {
      u.health = 1;
      u.money = Math.floor(u.money / 2);
      msg += ` You bled out — half your creds gone.`;
    }
  }
  const before = u.level;
  u = applyLevelUps(u);
  const leveled = u.level > before;
  await persist(u);
  return { user: u, message: msg, type, leveled };
}

export async function actWork(user: User): Promise<ActionResult> {
  if (user.energy < 15) return { user, message: "Too tired to work.", type: "fail", leveled: false };
  let u = { ...user, energy: user.energy - 15 };
  const pay = Math.floor((15 + Math.random() * 25) * (1 + u.level * 0.15));
  const xpGain = Math.floor(3 + Math.random() * 5);
  u.money += pay;
  u.xp += xpGain;
  const before = u.level;
  u = applyLevelUps(u);
  await persist(u);
  return { user: u, message: `Worked a shift. +$${pay}, +${xpGain} XP.`, type: "reward", leveled: u.level > before };
}

export async function actTrain(user: User): Promise<ActionResult> {
  let u = { ...user };
  const energyGain = Math.floor(15 + Math.random() * 15);
  const xpGain = Math.floor(5 + Math.random() * 8);
  u.energy = clamp(u.energy + energyGain, 0, u.maxEnergy);
  u.xp += xpGain;
  const before = u.level;
  u = applyLevelUps(u);
  await persist(u);
  return { user: u, message: `Trained at the gym. +${energyGain} EN, +${xpGain} XP.`, type: "reward", leveled: u.level > before };
}

export async function actHealPaid(user: User): Promise<ActionResult> {
  const cost = 25;
  if (user.money < cost) return { user, message: `Need $${cost} for the ripperdoc.`, type: "fail", leveled: false };
  if (user.health >= user.maxHealth) return { user, message: "Already at full health.", type: "info", leveled: false };
  const u = { ...user, money: user.money - cost, health: user.maxHealth };
  await persist(u);
  return { user: u, message: `Visited the ripperdoc. -$${cost}. Fully healed.`, type: "success", leveled: false };
}

export async function actHealFree(user: User): Promise<ActionResult> {
  if (user.health >= user.maxHealth) return { user, message: "Already at full health.", type: "info", leveled: false };
  const heal = Math.floor(8 + Math.random() * 8);
  const u = { ...user, health: clamp(user.health + heal, 0, user.maxHealth) };
  await persist(u);
  return { user: u, message: `Patched yourself up. +${heal} HP.`, type: "info", leveled: false };
}

async function persist(u: User) {
  await db.update(usersTable).set({
    money: u.money, health: u.health, energy: u.energy,
    level: u.level, xp: u.xp, maxHealth: u.maxHealth, maxEnergy: u.maxEnergy,
    crimesCommitted: u.crimesCommitted, missionsCompleted: u.missionsCompleted,
    lastSeen: new Date(),
  }).where(eq(usersTable.id, u.id));
}

// --- MISSIONS ---

export interface Mission {
  id: string;
  title: string;
  description: string;
  energyCost: number;
  moneyReward: number;
  xpReward: number;
  difficulty: "easy" | "medium" | "hard";
  type: "money" | "xp" | "mixed";
}

const MISSION_TEMPLATES: Array<Omit<Mission, "id" | "moneyReward" | "xpReward">> = [
  { title: "Smuggle Chrome", description: "Move a crate of black-market cyberware across the border zone.", energyCost: 20, difficulty: "medium", type: "money" },
  { title: "Decrypt a Datashard", description: "Crack the encryption on a stolen corporate datashard.", energyCost: 15, difficulty: "easy", type: "xp" },
  { title: "Bodyguard a Fixer", description: "Escort a high-paying fixer through gang territory.", energyCost: 25, difficulty: "hard", type: "mixed" },
  { title: "Bounty Hunt", description: "Track down a deserter wanted by the syndicate.", energyCost: 30, difficulty: "hard", type: "money" },
  { title: "Run Diagnostics", description: "Help a ripperdoc test new neural interfaces.", energyCost: 10, difficulty: "easy", type: "xp" },
  { title: "Steal a Prototype", description: "Lift an unreleased gadget from a research lab.", energyCost: 25, difficulty: "hard", type: "mixed" },
  { title: "Deliver a Package", description: "Quick run across the neon district. No questions asked.", energyCost: 12, difficulty: "easy", type: "money" },
  { title: "Sabotage a Server Farm", description: "Plant a virus deep in a rival corp's data center.", energyCost: 28, difficulty: "hard", type: "xp" },
  { title: "Rescue a Netrunner", description: "Pull a fried netrunner out of a dive bar before they get scrapped.", energyCost: 18, difficulty: "medium", type: "mixed" },
  { title: "Scout the Slums", description: "Map gang territories for a journalist on the take.", energyCost: 14, difficulty: "easy", type: "money" },
  { title: "Heist the Casino", description: "Hit the high-roller floor at the Crystal Sphere.", energyCost: 35, difficulty: "hard", type: "money" },
  { title: "Translate Old Net Lore", description: "Decode pre-collapse forum archives for a collector.", energyCost: 8, difficulty: "easy", type: "xp" },
];

export function generateMissions(level: number, count: number = 4): Mission[] {
  const shuffled = [...MISSION_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map((t, i) => {
    const diffMul = t.difficulty === "easy" ? 1 : t.difficulty === "medium" ? 1.6 : 2.4;
    const lvlMul = 1 + level * 0.18;
    const baseMoney = t.type === "xp" ? 8 : 30;
    const baseXp = t.type === "money" ? 4 : 18;
    return {
      ...t,
      id: `m-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      moneyReward: Math.floor(baseMoney * diffMul * lvlMul + Math.random() * 15),
      xpReward: Math.floor(baseXp * diffMul * (1 + level * 0.1) + Math.random() * 8),
    };
  });
}

export async function completeMission(user: User, mission: Mission): Promise<ActionResult> {
  if (user.energy < mission.energyCost) {
    return { user, message: `Need ${mission.energyCost} energy for "${mission.title}".`, type: "fail", leveled: false };
  }
  let u = { ...user };
  u.energy -= mission.energyCost;
  // 80% success on easy, 65% medium, 50% hard
  const successChance = mission.difficulty === "easy" ? 0.85 : mission.difficulty === "medium" ? 0.7 : 0.55;
  if (Math.random() < successChance) {
    u.money += mission.moneyReward;
    u.xp += mission.xpReward;
    u.missionsCompleted += 1;
    const before = u.level;
    u = applyLevelUps(u);
    await persist(u);
    return {
      user: u,
      message: `Mission "${mission.title}" complete. +$${mission.moneyReward}, +${mission.xpReward} XP.`,
      type: "reward",
      leveled: u.level > before,
    };
  } else {
    const dmg = Math.floor(5 + Math.random() * 15 * (mission.difficulty === "hard" ? 1.5 : 1));
    u.health = clamp(u.health - dmg, 0, u.maxHealth);
    if (u.health <= 0) { u.health = 1; u.money = Math.floor(u.money / 2); }
    await persist(u);
    return { user: u, message: `Mission "${mission.title}" failed. -${dmg} HP.`, type: "fail", leveled: false };
  }
}
