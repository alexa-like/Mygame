import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { authMiddleware, publicProfile } from "../lib/auth";

const router: IRouter = Router();

router.get("/players", authMiddleware, async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.level), desc(usersTable.xp)).limit(100);
  res.json({ players: users.map(publicProfile) });
});

router.get("/players/:id", authMiddleware, async (req, res) => {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id!)).limit(1);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "Player not found" });
  res.json({ player: publicProfile(user) });
});

export default router;
