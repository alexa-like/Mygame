import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { hashPin, generateToken, privateProfile } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  const { username, pin, email, gender } = req.body || {};
  if (!username || typeof username !== "string" || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 chars (letters, numbers, _, -)." });
  }
  if (!pin || typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4-8 digits." });
  }
  const cleanEmail = (typeof email === "string" ? email.trim().toLowerCase() : "");
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  const cleanGender = ["male", "female", "other", "prefer_not"].includes(gender) ? gender : "";

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing[0]) return res.status(409).json({ error: "Username taken." });

  // First registered user is the developer.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const role = count === 0 ? "dev" : "player";

  const token = generateToken();
  const pinHash = hashPin(pin);
  const result = await db.insert(usersTable).values({
    username, pinHash, token, email: cleanEmail, gender: cleanGender, role,
  }).returning();
  res.json({ user: privateProfile(result[0]!), emailVerificationNote: cleanEmail ? "Email saved (verification email is not yet enabled)." : null });
});

router.post("/auth/login", async (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || !pin) return res.status(400).json({ error: "Username and PIN required." });
  const rows = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  const user = rows[0];
  if (!user || user.pinHash !== hashPin(String(pin))) return res.status(401).json({ error: "Invalid credentials." });
  // Rotate token
  const token = generateToken();
  const updated = await db.update(usersTable).set({ token, lastSeen: new Date() }).where(eq(usersTable.id, user.id)).returning();
  res.json({ user: privateProfile(updated[0]!) });
});

export default router;
