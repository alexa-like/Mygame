import { db, usersTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { hashPin, generateToken } from "./auth";
import { logger } from "./logger";

// Seed the predefined developer account so it always exists.
export async function ensureDevAccount(): Promise<void> {
  const username = "Alexa_Ola";
  const password = "Hayatulahi3222";
  const rows = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (rows[0]) {
    if (rows[0].role !== "dev") {
      await db.update(usersTable).set({ role: "dev" }).where(eq(usersTable.id, rows[0].id));
      logger.info({ username }, "Promoted seeded account to dev role");
    }
    return;
  }
  await db.insert(usersTable).values({
    username,
    pinHash: hashPin(password),
    token: generateToken(),
    role: "dev",
    email: "",
    gender: "",
    money: 100000,
    level: 50,
    xp: 0,
    strength: 500, defense: 500, speed: 500, dexterity: 500,
  });
  logger.info({ username }, "Seeded developer account");
}

// Sweep accounts whose 60-min self-delete grace period has expired.
export async function sweepPendingDeletes(): Promise<number> {
  const cutoff = new Date();
  const dueRows = await db.select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(lt(usersTable.pendingDeleteAt, cutoff));
  if (dueRows.length === 0) return 0;
  for (const row of dueRows) {
    await db.delete(usersTable).where(eq(usersTable.id, row.id));
    logger.info({ username: row.username }, "Purged self-deleted account");
  }
  return dueRows.length;
}
