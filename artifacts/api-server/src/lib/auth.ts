import crypto from "node:crypto";
import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { applyRegen, statusOf } from "./game";

// Password hashing — uses scrypt (a slow, memory-hard KDF in node:crypto).
// Format: "scrypt$<saltHex>$<hashHex>". Legacy SHA-256 hashes (64 hex chars,
// no "$") are still recognized for verification so existing accounts keep
// working, and they are transparently upgraded on next successful login.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const LEGACY_SUFFIX = "::neon-streets";

function legacySha256(pin: string): string {
  return crypto.createHash("sha256").update(pin + LEGACY_SUFFIX).digest("hex");
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const actual = crypto.scryptSync(pin, salt, expected.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  // Legacy SHA-256 hash (64 hex chars). Constant-time compare.
  if (stored.length === 64 && /^[0-9a-f]+$/i.test(stored)) {
    const a = Buffer.from(stored, "hex");
    const b = Buffer.from(legacySha256(pin), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

export function isLegacyHash(stored: string): boolean {
  return stored.length === 64 && /^[0-9a-f]+$/i.test(stored);
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
  if (user.pendingDeleteAt) return res.status(403).json({ error: "Account is pending deletion. Log in again to cancel." });

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

export function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "dev")) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

export function devOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "dev") {
    return res.status(403).json({ error: "Developer access required" });
  }
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
    avatarUrl: u.avatarUrl,
    gender: u.gender,
    role: u.role,
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
    email: u.email,
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

// Admin view: includes everything a dev/admin needs to see
export function adminView(u: User) {
  return {
    ...privateProfile(u),
    pinHashLast4: u.pinHash.slice(-4),
    lastRegenAt: u.lastRegenAt,
  };
}
