import { Router, type IRouter } from "express";
import { authMiddleware, type AuthedRequest, privateProfile } from "../lib/auth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { transferMoney, recentTransfers, createTrade, listTradesFor, acceptTrade, rejectTrade } from "../lib/trade";

const router: IRouter = Router();

router.post("/transfer", authMiddleware, async (req: AuthedRequest, res) => {
  const { toUserId, amount, note } = req.body || {};
  const r = await transferMoney(req.user!, String(toUserId || ""), Number(amount || 0), String(note || ""));
  if ("error" in r) return res.status(400).json({ error: r.error });
  const fresh = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  res.json({ user: privateProfile(fresh[0]!), message: `Sent $${Math.floor(Number(amount))}.`, type: "success" });
});

router.get("/transfers", authMiddleware, async (req: AuthedRequest, res) => {
  res.json({ transfers: await recentTransfers(req.user!.id) });
});

router.get("/trades", authMiddleware, async (req: AuthedRequest, res) => {
  res.json(await listTradesFor(req.user!.id));
});

router.post("/trades", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await createTrade(req.user!, req.body || {});
  if ("error" in r) return res.status(400).json({ error: r.error });
  res.json({ trade: r.trade, message: "Trade proposed.", type: "info" });
});

router.post("/trades/:id/accept", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await acceptTrade(req.user!, req.params.id!);
  if ("error" in r) return res.status(400).json({ error: r.error });
  const fresh = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  res.json({ user: privateProfile(fresh[0]!), message: "Trade accepted.", type: "success" });
});

router.post("/trades/:id/reject", authMiddleware, async (req: AuthedRequest, res) => {
  const r = await rejectTrade(req.user!, req.params.id!);
  if ("error" in r) return res.status(400).json({ error: r.error });
  res.json({ message: "Trade closed.", type: "info" });
});

export default router;
