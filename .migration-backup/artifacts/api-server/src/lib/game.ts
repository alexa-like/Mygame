import { db, usersTable, inventoryTable, attacksTable, type User } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CITIES, HOME_CITY, CRIMES, JOBS, ITEMS, itemById, type Crime, type Job, type Item, type City } from "./catalog";

export function xpForNext(level: number): number {
  // Smoother curve so leveling feels achievable: L1→30, L5→73, L10→224, L20→2080.
  return Math.round(30 * Math.pow(1.25, level - 1));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function applyLevelUps(user: User): User {
  let u = { ...user };
  while (u.xp >= xpForNext(u.level)) {
    u.xp -= xpForNext(u.level);
    u.level += 1;
    u.maxHealth += 15;
    u.maxEnergy += 5;
    u.maxNerve += 1;
    u.health = u.maxHealth;
    u.energy = u.maxEnergy;
    u.nerve = u.maxNerve;
  }
  return u;
}

// --- REGEN ---
// Lazy regen on every authenticated read. Energy +1/30s, Nerve +1/120s, Happy +5/60s.
const REGEN_ENERGY_MS = 30 * 1000;
const REGEN_NERVE_MS = 120 * 1000;
const REGEN_HAPPY_MS = 60 * 1000;

export function applyRegen(u: User): User {
  const now = Date.now();
  const last = new Date(u.lastRegenAt).getTime();
  const elapsed = Math.max(0, now - last);
  if (elapsed < 5000) return u; // skip noise
  const eGain = Math.floor(elapsed / REGEN_ENERGY_MS);
  const nGain = Math.floor(elapsed / REGEN_NERVE_MS);
  const hGain = 5 * Math.floor(elapsed / REGEN_HAPPY_MS);
  if (eGain === 0 && nGain === 0 && hGain === 0) return u;
  // Compute remaining time delta to keep partial progress
  const consumedMs =
    eGain * REGEN_ENERGY_MS;
  return {
    ...u,
    energy: clamp(u.energy + eGain, 0, u.maxEnergy),
    nerve: clamp(u.nerve + nGain, 0, u.maxNerve),
    happy: clamp(u.happy + hGain, 0, u.maxHappy),
    lastRegenAt: new Date(last + Math.max(consumedMs, 1000)),
  };
}

// --- TRAVEL & STATUS ---
export function statusOf(u: User): { kind: "ok" | "traveling" | "hospital" | "jail"; until?: Date; from?: string; to?: string } {
  const now = Date.now();
  if (u.travelArrivalAt && new Date(u.travelArrivalAt).getTime() > now) {
    return { kind: "traveling", until: u.travelArrivalAt, from: u.travelFromCity || HOME_CITY, to: u.location };
  }
  if (u.hospitalUntil && new Date(u.hospitalUntil).getTime() > now) {
    return { kind: "hospital", until: u.hospitalUntil };
  }
  if (u.jailUntil && new Date(u.jailUntil).getTime() > now) {
    return { kind: "jail", until: u.jailUntil };
  }
  return { kind: "ok" };
}

async function persist(u: User) {
  await db.update(usersTable).set({
    money: u.money, health: u.health, energy: u.energy, nerve: u.nerve, happy: u.happy,
    level: u.level, xp: u.xp, respect: u.respect,
    maxHealth: u.maxHealth, maxEnergy: u.maxEnergy, maxNerve: u.maxNerve, maxHappy: u.maxHappy,
    strength: u.strength, defense: u.defense, speed: u.speed, dexterity: u.dexterity,
    location: u.location, travelFromCity: u.travelFromCity, travelArrivalAt: u.travelArrivalAt,
    hospitalUntil: u.hospitalUntil, jailUntil: u.jailUntil,
    crimesCommitted: u.crimesCommitted, missionsCompleted: u.missionsCompleted,
    attacksWon: u.attacksWon, attacksLost: u.attacksLost,
    lastSeen: new Date(), lastRegenAt: u.lastRegenAt,
  }).where(eq(usersTable.id, u.id));
}

export interface ActionResult {
  user: User;
  message: string;
  type: "success" | "fail" | "info" | "reward" | "levelup";
  leveled: boolean;
  detail?: Record<string, unknown>;
}

function requireFree(u: User): { error?: string } {
  const s = statusOf(u);
  if (s.kind === "traveling") return { error: "You're traveling. Wait until you arrive." };
  if (s.kind === "hospital") return { error: "You're in the hospital." };
  if (s.kind === "jail") return { error: "You're in jail." };
  return {};
}

// --- WORK ---
export async function doJob(user: User, jobId: string): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  if (user.location !== HOME_CITY) return { user, message: "Jobs are only available in Neo-Torin.", type: "fail", leveled: false };
  const job = JOBS.find((j) => j.id === jobId);
  if (!job) return { user, message: "Unknown job.", type: "fail", leveled: false };
  if (user.energy < job.energyCost) return { user, message: `Need ${job.energyCost} energy.`, type: "fail", leveled: false };

  let u = { ...user, energy: user.energy - job.energyCost };
  const pay = Math.floor(job.basePay * (1 + u.level * 0.12) * (0.9 + Math.random() * 0.4));
  const xpGain = Math.floor(job.baseXp + Math.random() * 3);
  u.money += pay;
  u.xp += xpGain;
  const before = u.level;
  u = applyLevelUps(u);
  await persist(u);
  return { user: u, message: `${job.name}: +$${pay}, +${xpGain} XP.`, type: "reward", leveled: u.level > before };
}

// --- HEAL ---
export async function actHealPaid(user: User): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  const cost = 50 + user.level * 10;
  if (user.money < cost) return { user, message: `Need $${cost} for the ripperdoc.`, type: "fail", leveled: false };
  if (user.health >= user.maxHealth) return { user, message: "Already at full health.", type: "info", leveled: false };
  const u = { ...user, money: user.money - cost, health: user.maxHealth };
  await persist(u);
  return { user: u, message: `Ripperdoc patched you up. -$${cost}.`, type: "success", leveled: false };
}

// --- CRIMES ---
export async function doCrime(user: User, crimeId: string): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  if (user.location !== HOME_CITY) return { user, message: "You can only run crimes in Neo-Torin.", type: "fail", leveled: false };
  const crime = CRIMES.find((c) => c.id === crimeId);
  if (!crime) return { user, message: "Unknown crime.", type: "fail", leveled: false };
  if (user.level < crime.levelReq) return { user, message: `Requires level ${crime.levelReq}.`, type: "fail", leveled: false };
  if (user.nerve < crime.nerveCost) return { user, message: `Need ${crime.nerveCost} nerve.`, type: "fail", leveled: false };

  let u = { ...user, nerve: user.nerve - crime.nerveCost };
  // success chance scales slightly with dexterity & speed
  const stealth = (u.dexterity + u.speed) / 2;
  const chance = clamp(crime.baseSuccess + stealth * 0.0008 + (u.level - crime.levelReq) * 0.005, 0.05, 0.96);
  if (Math.random() < chance) {
    const reward = Math.floor(crime.moneyMin + Math.random() * (crime.moneyMax - crime.moneyMin));
    const xpGain = Math.floor(crime.xpReward * (0.85 + Math.random() * 0.3));
    u.money += reward;
    u.xp += xpGain;
    u.crimesCommitted += 1;
    const before = u.level;
    u = applyLevelUps(u);
    await persist(u);
    return { user: u, message: `${crime.name} succeeded. +$${reward}, +${xpGain} XP.`, type: "success", leveled: u.level > before };
  } else {
    // Failure: chance of jail
    let msg = `${crime.name} failed.`;
    if (Math.random() < crime.jailRisk) {
      const seconds = 30 + Math.floor(crime.nerveCost * 6);
      u.jailUntil = new Date(Date.now() + seconds * 1000);
      msg += ` Cuffed for ${seconds}s.`;
    } else {
      const dmg = Math.floor(5 + Math.random() * (5 + crime.nerveCost * 2));
      u.health = clamp(u.health - dmg, 0, u.maxHealth);
      msg += ` Took ${dmg} HP damage.`;
      if (u.health <= 0) {
        u.health = 1;
        u.hospitalUntil = new Date(Date.now() + 60 * 1000);
        msg += " Hospitalized.";
      }
    }
    await persist(u);
    return { user: u, message: msg, type: "fail", leveled: false };
  }
}

// --- GYM ---
export type BattleStat = "strength" | "defense" | "speed" | "dexterity";
const STAT_LABEL: Record<BattleStat, string> = { strength: "Strength", defense: "Defense", speed: "Speed", dexterity: "Dexterity" };

export async function doGym(user: User, stat: BattleStat, sets = 1): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  if (!["strength", "defense", "speed", "dexterity"].includes(stat)) {
    return { user, message: "Unknown stat.", type: "fail", leveled: false };
  }
  const eCost = 5;
  const hCost = 5;
  const requested = Math.max(1, Math.min(20, Math.floor(Number(sets) || 1)));
  // Cap by what the user can afford in energy/happy.
  const maxByEnergy = Math.floor(user.energy / eCost);
  const maxByHappy = Math.max(0, Math.floor(user.happy / Math.max(1, hCost)));
  const reps = Math.max(0, Math.min(requested, maxByEnergy, maxByHappy));
  if (reps <= 0) {
    if (maxByEnergy <= 0) return { user, message: `Need ${eCost} energy.`, type: "fail", leveled: false };
    return { user, message: "You're too unhappy to focus. Buy a Mood Pill.", type: "fail", leveled: false };
  }

  let totalGain = 0;
  let u = { ...user };
  for (let i = 0; i < reps; i++) {
    const happyMul = 0.5 + (u.happy / u.maxHappy) * 1.5;
    const cur = (u as any)[stat] as number;
    const diminish = Math.max(0.4, 1 - (cur - 10) * 0.005);
    const baseGain = 0.6 + Math.random() * 0.8;
    const gain = Math.max(0.1, Math.round(baseGain * happyMul * diminish * 10) / 10);
    (u as any)[stat] = Math.round((cur + gain) * 10) / 10;
    u.energy -= eCost;
    u.happy = clamp(u.happy - hCost, 0, u.maxHappy);
    u.xp += 1;
    totalGain += gain;
  }
  totalGain = Math.round(totalGain * 10) / 10;
  const before = u.level;
  u = applyLevelUps(u);
  await persist(u);
  return {
    user: u,
    message: `Trained ${STAT_LABEL[stat]} +${totalGain} over ${reps} set${reps === 1 ? "" : "s"}.`,
    type: "reward",
    leveled: u.level > before,
    detail: { stat, gain: totalGain, sets: reps },
  };
}

// --- TRAVEL ---
export async function startTravel(user: User, cityId: string): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  const city = CITIES.find((c) => c.id === cityId);
  if (!city) return { user, message: "Unknown destination.", type: "fail", leveled: false };
  if (city.id === user.location) return { user, message: "You're already there.", type: "fail", leveled: false };

  // All travel goes through home: if abroad, return home first.
  let from = user.location;
  let dest: City;
  let cost = 0;
  let secs = 0;
  if (user.location !== HOME_CITY && city.id !== HOME_CITY) {
    return { user, message: "You must return to Neo-Torin first.", type: "fail", leveled: false };
  }
  if (user.location === HOME_CITY) {
    dest = city;
    cost = city.travelCost;
    secs = city.travelSeconds;
  } else {
    // returning home
    const fromCity = CITIES.find((c) => c.id === user.location)!;
    dest = CITIES.find((c) => c.id === HOME_CITY)!;
    cost = Math.floor(fromCity.travelCost * 0.5);
    secs = fromCity.travelSeconds;
  }
  if (user.money < cost) return { user, message: `Need $${cost} for the trip.`, type: "fail", leveled: false };

  const u = {
    ...user,
    money: user.money - cost,
    travelFromCity: from,
    location: dest.id,
    travelArrivalAt: new Date(Date.now() + secs * 1000),
  };
  await persist(u);
  return { user: u, message: `Traveling to ${dest.name} (${secs}s, -$${cost}).`, type: "info", leveled: false };
}

// --- INVENTORY ---
export async function getInventory(userId: string) {
  const rows = await db.select().from(inventoryTable).where(eq(inventoryTable.userId, userId));
  return rows.filter((r) => r.quantity > 0).map((r) => {
    const item = itemById(r.itemId);
    return { itemId: r.itemId, quantity: r.quantity, item };
  });
}

async function addInventory(userId: string, itemId: string, qty: number) {
  const existing = await db.select().from(inventoryTable)
    .where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId))).limit(1);
  if (existing[0]) {
    const newQty = existing[0].quantity + qty;
    if (newQty <= 0) {
      await db.delete(inventoryTable).where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId)));
    } else {
      await db.update(inventoryTable).set({ quantity: newQty })
        .where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId)));
    }
  } else if (qty > 0) {
    await db.insert(inventoryTable).values({ userId, itemId, quantity: qty });
  }
}

export async function buyItem(user: User, itemId: string, qty: number): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  if (qty <= 0 || qty > 50) return { user, message: "Invalid quantity.", type: "fail", leveled: false };
  const { shopInventory, shopPriceFor } = await import("./catalog");
  const stock = shopInventory(user.location);
  const item = stock.find((i) => i.id === itemId);
  if (!item) return { user, message: "That isn't sold here.", type: "fail", leveled: false };
  const unit = shopPriceFor(item, user.location);
  const total = unit * qty;
  if (user.money < total) return { user, message: `Need $${total}.`, type: "fail", leveled: false };
  const u = { ...user, money: user.money - total };
  await persist(u);
  await addInventory(u.id, itemId, qty);
  return { user: u, message: `Bought ${qty}× ${item.name} for $${total}.`, type: "success", leveled: false };
}

export async function sellItem(user: User, itemId: string, qty: number): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  const item = itemById(itemId);
  if (!item) return { user, message: "Unknown item.", type: "fail", leveled: false };
  const inv = await db.select().from(inventoryTable)
    .where(and(eq(inventoryTable.userId, user.id), eq(inventoryTable.itemId, itemId))).limit(1);
  if (!inv[0] || inv[0].quantity < qty || qty <= 0) return { user, message: "Not enough to sell.", type: "fail", leveled: false };
  const { sellbackPriceFor } = await import("./catalog");
  const unit = sellbackPriceFor(item, user.location);
  const total = unit * qty;
  await addInventory(user.id, itemId, -qty);
  const u = { ...user, money: user.money + total };
  await persist(u);
  return { user: u, message: `Sold ${qty}× ${item.name} for $${total}.`, type: "reward", leveled: false };
}

export async function useItem(user: User, itemId: string): Promise<ActionResult> {
  const item = itemById(itemId);
  if (!item) return { user, message: "Unknown item.", type: "fail", leveled: false };
  if (item.category !== "consumable" || !item.effect) return { user, message: "Can't use that.", type: "fail", leveled: false };
  const inv = await db.select().from(inventoryTable)
    .where(and(eq(inventoryTable.userId, user.id), eq(inventoryTable.itemId, itemId))).limit(1);
  if (!inv[0] || inv[0].quantity < 1) return { user, message: "You don't have any.", type: "fail", leveled: false };
  await addInventory(user.id, itemId, -1);
  const u = { ...user };
  const eff = item.effect;
  if (eff.stat === "health") u.health = clamp(u.health + eff.amount, 0, u.maxHealth);
  if (eff.stat === "energy") u.energy = clamp(u.energy + eff.amount, 0, u.maxEnergy);
  if (eff.stat === "nerve")  u.nerve  = clamp(u.nerve  + eff.amount, 0, u.maxNerve);
  if (eff.stat === "happy")  u.happy  = clamp(u.happy  + eff.amount, 0, u.maxHappy);
  await persist(u);
  return { user: u, message: `Used ${item.name}. +${eff.amount} ${eff.stat.toUpperCase()}.`, type: "success", leveled: false };
}

// Best equipped weapon = highest attackPower in inventory
export async function bestGear(userId: string) {
  const inv = await getInventory(userId);
  let weapon: Item | null = null, armor: Item | null = null;
  for (const r of inv) {
    if (!r.item) continue;
    if (r.item.category === "weapon" && (!weapon || (r.item.attackPower || 0) > (weapon.attackPower || 0))) weapon = r.item;
    if (r.item.category === "armor"  && (!armor  || (r.item.defensePower || 0) > (armor.defensePower || 0))) armor = r.item;
  }
  return { weapon, armor };
}

// --- ATTACK / PVP ---
export async function attackPlayer(attacker: User, defenderId: string): Promise<ActionResult & { defender?: User }> {
  const block = requireFree(attacker);
  if (block.error) return { user: attacker, message: block.error, type: "fail", leveled: false };
  if (attacker.id === defenderId) return { user: attacker, message: "Can't attack yourself.", type: "fail", leveled: false };
  if (attacker.energy < 25) return { user: attacker, message: "Need 25 energy to attack.", type: "fail", leveled: false };

  const dRows = await db.select().from(usersTable).where(eq(usersTable.id, defenderId)).limit(1);
  const defender0 = dRows[0];
  if (!defender0) return { user: attacker, message: "Target not found.", type: "fail", leveled: false };
  const defender = applyRegen(defender0);
  if (defender.location !== attacker.location) {
    return { user: attacker, message: "Target is in a different city.", type: "fail", leveled: false };
  }
  const dStatus = statusOf(defender);
  if (dStatus.kind !== "ok") return { user: attacker, message: `Target is ${dStatus.kind}.`, type: "fail", leveled: false };

  const aGear = await bestGear(attacker.id);
  const dGear = await bestGear(defender.id);

  const aPower = attacker.strength * 0.55 + attacker.speed * 0.25 + attacker.dexterity * 0.20 + (aGear.weapon?.attackPower || 0);
  const dPower = defender.defense  * 0.65 + defender.dexterity * 0.20 + defender.speed * 0.15 + (dGear.armor?.defensePower || 0);

  // RNG ±25%
  const aRoll = aPower * (0.75 + Math.random() * 0.5);
  const dRoll = dPower * (0.75 + Math.random() * 0.5);
  const winnerIsAttacker = aRoll > dRoll;

  let a = { ...attacker, energy: attacker.energy - 25 };
  let d = { ...defender };
  let log = "";
  let resultType: ActionResult["type"] = "info";
  let damageDealt = 0;
  let stolen = 0;
  let respect = 0;

  if (winnerIsAttacker) {
    damageDealt = Math.max(10, Math.floor(aRoll - dRoll * 0.5));
    d.health = clamp(d.health - damageDealt, 0, d.maxHealth);
    stolen = Math.floor(d.money * (0.05 + Math.random() * 0.10));
    respect = Math.max(1, Math.floor(5 + (defender.level - attacker.level)));
    d.money -= stolen;
    a.money += stolen;
    a.respect += respect;
    a.attacksWon += 1;
    d.attacksLost += 1;
    if (d.health <= 0) {
      d.health = 1;
      const hospSecs = 60 + Math.min(240, damageDealt);
      d.hospitalUntil = new Date(Date.now() + hospSecs * 1000);
      log = `You hospitalized ${defender.username}. -${damageDealt} HP, stole $${stolen}, +${respect} respect.`;
    } else {
      log = `You beat ${defender.username}. -${damageDealt} HP, stole $${stolen}, +${respect} respect.`;
    }
    resultType = "success";
  } else {
    damageDealt = Math.max(10, Math.floor(dRoll - aRoll * 0.5));
    a.health = clamp(a.health - damageDealt, 0, a.maxHealth);
    a.attacksLost += 1;
    d.attacksWon += 1;
    d.respect += 3;
    if (a.health <= 0) {
      a.health = 1;
      const hospSecs = 60 + Math.min(240, damageDealt);
      a.hospitalUntil = new Date(Date.now() + hospSecs * 1000);
      log = `${defender.username} hospitalized you. -${damageDealt} HP.`;
    } else {
      log = `${defender.username} fought you off. -${damageDealt} HP.`;
    }
    resultType = "fail";
  }

  await persist(a);
  await persist(d);

  const winnerId = winnerIsAttacker ? a.id : d.id;
  await db.insert(attacksTable).values({
    attackerId: a.id, defenderId: d.id, winnerId,
    moneyStolen: stolen, respectGained: respect, damageDealt, log,
  });

  return { user: a, defender: d, message: log, type: resultType, leveled: false };
}

// --- MISSIONS removed: see lib/missions.ts (new time-gated flow). Kept type for compatibility. ---

export interface Mission {
  id: string; title: string; description: string;
  energyCost: number; moneyReward: number; xpReward: number;
  difficulty: "easy" | "medium" | "hard"; type: "money" | "xp" | "mixed";
}

const MISSION_TEMPLATES: Array<Omit<Mission, "id" | "moneyReward" | "xpReward">> = [
  { title: "Smuggle Chrome", description: "Move a crate of black-market cyberware.", energyCost: 20, difficulty: "medium", type: "money" },
  { title: "Decrypt a Datashard", description: "Crack a stolen corporate datashard.", energyCost: 15, difficulty: "easy", type: "xp" },
  { title: "Bodyguard a Fixer", description: "Escort a fixer through gang territory.", energyCost: 25, difficulty: "hard", type: "mixed" },
  { title: "Bounty Hunt", description: "Track down a deserter for the syndicate.", energyCost: 30, difficulty: "hard", type: "money" },
  { title: "Run Diagnostics", description: "Help a ripperdoc test new neural ware.", energyCost: 10, difficulty: "easy", type: "xp" },
  { title: "Steal a Prototype", description: "Lift an unreleased gadget from a lab.", energyCost: 25, difficulty: "hard", type: "mixed" },
  { title: "Deliver a Package", description: "Quick run across the neon district.", energyCost: 12, difficulty: "easy", type: "money" },
  { title: "Sabotage a Server Farm", description: "Plant a virus deep in a rival's data center.", energyCost: 28, difficulty: "hard", type: "xp" },
  { title: "Rescue a Netrunner", description: "Pull a fried netrunner out of a dive bar.", energyCost: 18, difficulty: "medium", type: "mixed" },
  { title: "Scout the Slums", description: "Map gang territories for a journalist.", energyCost: 14, difficulty: "easy", type: "money" },
  { title: "Heist the Casino", description: "Hit the high-roller floor at Crystal Sphere.", energyCost: 35, difficulty: "hard", type: "money" },
  { title: "Translate Old Net Lore", description: "Decode pre-collapse forum archives.", energyCost: 8, difficulty: "easy", type: "xp" },
];

export function generateMissions(level: number, count: number = 4): Mission[] {
  const shuffled = [...MISSION_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map((t, i) => {
    const diffMul = t.difficulty === "easy" ? 1 : t.difficulty === "medium" ? 1.6 : 2.4;
    const lvlMul = 1 + level * 0.18;
    const baseMoney = t.type === "xp" ? 12 : 50;
    const baseXp = t.type === "money" ? 5 : 22;
    return {
      ...t,
      id: `m-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      moneyReward: Math.floor(baseMoney * diffMul * lvlMul + Math.random() * 20),
      xpReward: Math.floor(baseXp * diffMul * (1 + level * 0.1) + Math.random() * 10),
    };
  });
}

export async function completeMission(user: User, mission: Mission): Promise<ActionResult> {
  const block = requireFree(user);
  if (block.error) return { user, message: block.error, type: "fail", leveled: false };
  if (user.energy < mission.energyCost) {
    return { user, message: `Need ${mission.energyCost} energy.`, type: "fail", leveled: false };
  }
  let u = { ...user, energy: user.energy - mission.energyCost };
  const successChance = mission.difficulty === "easy" ? 0.85 : mission.difficulty === "medium" ? 0.7 : 0.55;
  if (Math.random() < successChance) {
    u.money += mission.moneyReward;
    u.xp += mission.xpReward;
    u.missionsCompleted += 1;
    const before = u.level;
    u = applyLevelUps(u);
    await persist(u);
    return { user: u, message: `Mission "${mission.title}" complete. +$${mission.moneyReward}, +${mission.xpReward} XP.`, type: "reward", leveled: u.level > before };
  } else {
    const dmg = Math.floor(8 + Math.random() * 18 * (mission.difficulty === "hard" ? 1.5 : 1));
    u.health = clamp(u.health - dmg, 0, u.maxHealth);
    if (u.health <= 0) {
      u.health = 1;
      u.hospitalUntil = new Date(Date.now() + 60 * 1000);
    }
    await persist(u);
    return { user: u, message: `Mission "${mission.title}" failed. -${dmg} HP.`, type: "fail", leveled: false };
  }
}

// --- BUST OUT OF HOSPITAL/JAIL ---
export async function bustHospital(user: User): Promise<ActionResult> {
  const s = statusOf(user);
  if (s.kind !== "hospital") return { user, message: "You're not in hospital.", type: "fail", leveled: false };
  const remainingMs = new Date(s.until!).getTime() - Date.now();
  const cost = Math.max(50, Math.floor(remainingMs / 1000) * (5 + user.level));
  if (user.money < cost) return { user, message: `Discharge costs $${cost}.`, type: "fail", leveled: false };
  const u = { ...user, money: user.money - cost, hospitalUntil: null };
  await persist(u);
  return { user: u, message: `Discharged early. -$${cost}.`, type: "success", leveled: false };
}
