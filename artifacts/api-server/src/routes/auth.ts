import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPin, generateToken, privateProfile } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res) => {
  const { username, pin } = req.body || {};
  if (typeof username !== "string" || typeof pin !== "string") {
    return res.status(400).json({ error: "username and pin required" });
  }
  const name = username.trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(name)) {
    return res.status(400).json({ error: "Username must be 3-20 chars (letters, numbers, _ or -)" });
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4-8 digits" });
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.username, name)).limit(1);
  if (existing[0]) return res.status(409).json({ error: "Username already taken" });

  const token = generateToken();
  const inserted = await db.insert(usersTable).values({
    username: name,
    pinHash: hashPin(pin),
    token,
  }).returning();
  const user = inserted[0]!;
  res.json({ user: privateProfile(user) });
});

router.post("/auth/login", async (req, res) => {
  const { username, pin } = req.body || {};
  if (typeof username !== "string" || typeof pin !== "string") {
    return res.status(400).json({ error: "username and pin required" });
  }
  const rows = await db.select().from(usersTable).where(eq(usersTable.username, username.trim())).limit(1);
  const user = rows[0];
  if (!user || user.pinHash !== hashPin(pin)) {
    return res.status(401).json({ error: "Invalid username or PIN" });
  }
  // Rotate token on login for security
  const token = generateToken();
  await db.update(usersTable).set({ token, lastSeen: new Date() }).where(eq(usersTable.id, user.id));
  res.json({ user: privateProfile({ ...user, token }) });
});

export default router;
