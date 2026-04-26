import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  hashPin,
  generateToken,
  privateProfile,
  authMiddleware,
  type AuthedRequest,
} from "../lib/auth";

const router = Router();

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
    return res.status(409
