import crypto from "node:crypto";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

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
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.slice(7).trim();
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const rows = await db.select().from(usersTable).where(eq(usersTable.token, token)).limit(1);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid token" });

  await db.update(usersTable).set({ lastSeen: new Date() }).where(eq(usersTable.id, user.id));
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
    xp: u.xp,
    money: u.money,
    health: u.health,
    energy: u.energy,
    maxHealth: u.maxHealth,
    maxEnergy: u.maxEnergy,
    crimesCommitted: u.crimesCommitted,
    missionsCompleted: u.missionsCompleted,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
  };
}

export function privateProfile(u: User) {
  return { ...publicProfile(u), token: u.token };
}
