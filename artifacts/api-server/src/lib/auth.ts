import crypto from "node:crypto";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { applyRegen, statusOf } from "./game";

export function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin + "::neon-streets").digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface AuthedRequest extends Request {
  user?: User;
}

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.slice(7).trim();
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const rows = await db.select().from(usersTable).where(eq(usersTable.token, token)).limit(1);
  let user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid token" });

  // Apply regen + persist if changed
  const regenned = applyRegen(user);
  if (regenned !== user) {
    await db.update(usersTable).set({
      energy: regenned.energy, nerve: regenned.nerve, happy: regenned.happy,
      lastRegenAt: regenned.lastRegenAt, lastSeen: new Date(),
    }).where(eq(usersTable.id, user.id));
    user = regenned;
  } else {
    await db.update(usersTable).set({ lastSeen: new Date() }).where(eq(usersTable.id, user.id));
  }
  req.user = user;
  next();
}

export async function userByToken(token: string): Promise<User | null> {
  if (!token) return null;
  const rows = await db.select().from(usersTable).where(eq(usersTable.token, token)).limit(1);
  return rows[0] ?? null;
}

export function publicProfile(u: User) {
  return {
    id: u.id,
    username: u.username,
    bio: u.bio,
    avatar: u.avatar,
    level: u.level,
    money: u.money,
    respect: u.respect,
    health: u.health,
    maxHealth: u.maxHealth,
    location: u.location,
    strength: u.strength,
    defense: u.defense,
    speed: u.speed,
    dexterity: u.dexterity,
    crimesCommitted: u.crimesCommitted,
    missionsCompleted: u.missionsCompleted,
    attacksWon: u.attacksWon,
    attacksLost: u.attacksLost,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
    status: statusOf(u),
  };
}

export function privateProfile(u: User) {
  return {
    ...publicProfile(u),
    token: u.token,
    xp: u.xp,
    energy: u.energy,
    maxEnergy: u.maxEnergy,
    nerve: u.nerve,
    maxNerve: u.maxNerve,
    happy: u.happy,
    maxHappy: u.maxHappy,
    travelFromCity: u.travelFromCity,
    travelArrivalAt: u.travelArrivalAt,
    hospitalUntil: u.hospitalUntil,
    jailUntil: u.jailUntil,
  };
}
