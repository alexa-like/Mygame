import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  hashPin,
  verifyPin,
  isLegacyHash,
  generateToken,
  privateProfile,
  authMiddleware,
  type AuthedRequest,
} from "../lib/auth";

const router: IRouter = Router();

// Reserved usernames that cannot be created via /auth/register
const RESERVED_USERNAMES = new Set([
  "alexa_ola",
  "system",
  "admin",
  "developer",
  "dev",
]);

function validatePassword(p: unknown): string | null {
  if (!p || typeof p !== "string") return "Password required.";
  if (p.length < 4 || p.length > 32)
    return "Password must be 4-32 characters.";
  if (!/^[A-Za-z0-9_!@#$%^&*-]+$/.test(p))
    return "Password may contain letters, numbers, and !@#$%^&*-_ only.";
  return null;
}

router.post("/auth/register", async (req, res) => {
  const { username, pin, email, gender } = req.body || {};

  if (
    !username ||
    typeof username !== "string" ||
    username.length < 3 ||
    username.length > 20 ||
    !/^[a-zA-Z0-9_-]+$/.test(username)
  ) {
    return res
      .status(400)
      .json({ error: "Username must be 3-20 chars (letters, numbers, _, -)." });
  }

  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return res.status(409).json({ error: "Username is reserved." });
  }

  const pwErr = validatePassword(pin);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const cleanEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format." });
  }

  const cleanGender = ["male", "female", "other", "prefer_not"].includes(gender)
    ? gender
    : "";

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (existing[0]) {
    return res.status(409).json({ error: "Username already taken." });
  }

  // All public registrations create a regular player. Dev/admin accounts must
  // be provisioned out-of-band (via the env-gated seed in `lib/seed.ts` for
  // local dev, or by an existing dev promoting a player via /admin/role).
  const role = "player";

  const token = generateToken();
  const inserted = await db
    .insert(usersTable)
    .values({
      username,
      pinHash: hashPin(pin),
      token,
      email: cleanEmail,
      gender: cleanGender,
      role,
    })
    .returning();

  const user = inserted[0]!;
  return res.json({ token, user: privateProfile(user) });
});

router.post("/auth/login", async (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || typeof username !== "string" || !pin || typeof pin !== "string") {
    return res.status(400).json({ error: "Username and password required." });
  }

  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials." });
  if (!verifyPin(pin, user.pinHash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  // Transparently upgrade legacy SHA-256 hashes to scrypt on successful login.
  if (isLegacyHash(user.pinHash)) {
    const upgraded = hashPin(pin);
    await db
      .update(usersTable)
      .set({ pinHash: upgraded })
      .where(eq(usersTable.id, user.id));
    user.pinHash = upgraded;
  }

  // Logging back in cancels a pending self-delete.
  if (user.pendingDeleteAt) {
    await db
      .update(usersTable)
      .set({ pendingDeleteAt: null })
      .where(eq(usersTable.id, user.id));
    user.pendingDeleteAt = null;
  }

  return res.json({ token: user.token, user: privateProfile(user) });
});

router.post(
  "/auth/change-password",
  authMiddleware,
  async (req: AuthedRequest, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || typeof oldPassword !== "string") {
      return res.status(400).json({ error: "Old password required." });
    }
    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const u = req.user!;
    if (!verifyPin(oldPassword, u.pinHash)) {
      return res.status(401).json({ error: "Old password is incorrect." });
    }

    const newToken = generateToken();
    await db
      .update(usersTable)
      .set({ pinHash: hashPin(newPassword), token: newToken })
      .where(eq(usersTable.id, u.id));

    return res.json({ ok: true, token: newToken });
  },
);

router.post(
  "/auth/delete-account",
  authMiddleware,
  async (req: AuthedRequest, res) => {
    const { password } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "Password required." });
    }

    const u = req.user!;
    if (u.role === "dev") {
      return res.status(403).json({ error: "Dev accounts cannot self-delete." });
    }
    if (!verifyPin(password, u.pinHash)) {
      return res.status(401).json({ error: "Password is incorrect." });
    }

    // Schedule purge ~60 min from now and rotate token (logs out all sessions).
    const pendingDeleteAt = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(usersTable)
      .set({ pendingDeleteAt, token: generateToken() })
      .where(eq(usersTable.id, u.id));

    return res.json({
      ok: true,
      pendingDeleteAt: pendingDeleteAt.toISOString(),
    });
  },
);

export default router;
