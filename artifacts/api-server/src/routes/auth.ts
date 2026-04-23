import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { hashPin, generateToken, privateProfile, authMiddleware, type AuthedRequest } from "../lib/auth";

const router: IRouter = Router();

// Reserved usernames that cannot be created via /auth/register
const RESERVED_USERNAMES = new Set(["alexa_ola", "system", "admin", "developer", "dev"]);

function validatePassword(p: unknown): string | null {
  if (!p || typeof p !== "string") return "Password required.";
  if (p.length < 4 || p.length > 32) return "Password must be 4-32 characters.";
  if (!/^[A-Za-z0-9_!@#$%^&*-]+$/.test(p)) return "Password may contain letters, numbers, and !@#$%^&*-_ only.";
  return null;
}

router.post("/auth/register", async (req, res) => {
  const { username, pin, email, gender } = req.body || {};
  if (!username || typeof username !== "string" || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 chars (letters, numbers, _, -)." });
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return res.status(409).json({ error: "Username is reserved." });
  }
  const pwErr = validatePassword(pin);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const cleanEmail = (typeof email === "string" ? email.trim().toLowerCase() : "");
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  const cleanGender = ["male", "female", "other", "prefer_not"].includes(gender) ? gender : "";

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing[0]) return res.status(409).json({ error: "Username taken." });

  // First registered user is the developer (legacy behaviour; Alexa_Ola is also seeded).
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
  if (!username || !pin) return res.status(400).json({ error: "Username and password required." });
  const rows = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  const user = rows[0];
  if (!user || user.pinHash !== hashPin(String(pin))) return res.status(401).json({ error: "Invalid credentials." });
  const token = generateToken();
  // Logging back in cancels any pending self-deletion
  const updated = await db.update(usersTable)
    .set({ token, lastSeen: new Date(), pendingDeleteAt: null })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json({ user: privateProfile(updated[0]!) });
});

// Change password (requires old password)
router.post("/auth/change-password", authMiddleware, async (req: AuthedRequest, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "Both old and new password required." });
  const u = req.user!;
  if (u.pinHash !== hashPin(String(oldPassword))) return res.status(401).json({ error: "Old password is wrong." });
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const newToken = generateToken();
  const updated = await db.update(usersTable)
    .set({ pinHash: hashPin(String(newPassword)), token: newToken })
    .where(eq(usersTable.id, u.id))
    .returning();
  res.json({ user: privateProfile(updated[0]!), message: "Password changed. Sessions on other devices were revoked." });
});

// Request self-delete (60-min grace; logging back in cancels it)
router.post("/auth/delete-account", authMiddleware, async (req: AuthedRequest, res) => {
  const { password } = req.body || {};
  const u = req.user!;
  if (!password || u.pinHash !== hashPin(String(password))) return res.status(401).json({ error: "Password is wrong." });
  if (u.role === "dev") return res.status(403).json({ error: "Developer account cannot self-delete." });
  const pendingDeleteAt = new Date(Date.now() + 60 * 60 * 1000);
  // Rotate token to log out all sessions immediately
  await db.update(usersTable)
    .set({ pendingDeleteAt, token: generateToken() })
    .where(eq(usersTable.id, u.id));
  res.json({ ok: true, pendingDeleteAt: pendingDeleteAt.toISOString(), message: "Account scheduled for deletion in 60 minutes. Log in again within that window to cancel." });
});

export default router;
