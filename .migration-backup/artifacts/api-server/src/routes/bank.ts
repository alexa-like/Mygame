import { Router, type IRouter } from "express";
import { db, usersTable, bankDepositsTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { authMiddleware, privateProfile, type AuthedRequest } from "../lib/auth";
import { logEvent } from "../lib/events";

const router: IRouter = Router();

// Term -> APR. Effective interest paid at maturity = amount * rate.
const TERMS: Record<number, number> = {
  1: 0.02,   // 1 day → +2%
  7: 0.08,   // 7 days → +8%
  30: 0.25,  // 30 days → +25%
};

router.get("/bank", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const deposits = await db.select().from(bankDepositsTable)
    .where(and(eq(bankDepositsTable.userId, u.id), isNull(bankDepositsTable.withdrawnAt)))
    .orderBy(desc(bankDepositsTable.depositedAt));
  res.json({
    walletMoney: u.money,
    bankBalance: u.bankBalance,
    deposits,
    terms: Object.entries(TERMS).map(([d, r]) => ({ durationDays: Number(d), rate: r })),
  });
});

// Quick-deposit (no term, 0% interest) — money parked in the bank for safekeeping.
router.post("/bank/park", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const amount = Math.floor(Number(req.body?.amount || 0));
  if (amount <= 0) return res.status(400).json({ error: "Amount must be positive." });
  if (amount > u.money) return res.status(400).json({ error: "Not enough cash on hand." });
  const updated = await db.update(usersTable)
    .set({ money: u.money - amount, bankBalance: u.bankBalance + amount })
    .where(eq(usersTable.id, u.id))
    .returning();
  await logEvent(u.id, "bank", `Parked $${amount} in bank.`, -amount);
  res.json({ user: privateProfile(updated[0]!), message: `Parked $${amount}.` });
});

router.post("/bank/unpark", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const amount = Math.floor(Number(req.body?.amount || 0));
  if (amount <= 0) return res.status(400).json({ error: "Amount must be positive." });
  if (amount > u.bankBalance) return res.status(400).json({ error: "Not enough in bank." });
  const updated = await db.update(usersTable)
    .set({ money: u.money + amount, bankBalance: u.bankBalance - amount })
    .where(eq(usersTable.id, u.id))
    .returning();
  await logEvent(u.id, "bank", `Withdrew $${amount} from bank.`, amount);
  res.json({ user: privateProfile(updated[0]!), message: `Withdrew $${amount}.` });
});

// Term deposit (locks money, pays interest at maturity)
router.post("/bank/deposit", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const amount = Math.floor(Number(req.body?.amount || 0));
  const days = Math.floor(Number(req.body?.durationDays || 0));
  if (amount < 100) return res.status(400).json({ error: "Minimum deposit is $100." });
  if (amount > u.money) return res.status(400).json({ error: "Not enough cash on hand." });
  const rate = TERMS[days];
  if (!rate) return res.status(400).json({ error: "Choose 1, 7, or 30 days." });

  const now = new Date();
  const matures = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  await db.update(usersTable)
    .set({ money: u.money - amount })
    .where(eq(usersTable.id, u.id));
  const inserted = await db.insert(bankDepositsTable).values({
    userId: u.id, amount, durationDays: days, interestRate: rate,
    depositedAt: now, maturesAt: matures,
  }).returning();
  await logEvent(u.id, "bank", `Locked $${amount} for ${days} day${days === 1 ? "" : "s"} at ${(rate * 100).toFixed(0)}%.`, -amount, { depositId: inserted[0]!.id });
  res.json({ deposit: inserted[0], message: `Deposit locked. Matures ${matures.toISOString()}.` });
});

router.post("/bank/withdraw", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = String(req.body?.id || "");
  if (!id) return res.status(400).json({ error: "id required" });
  const rows = await db.select().from(bankDepositsTable).where(eq(bankDepositsTable.id, id)).limit(1);
  const dep = rows[0];
  if (!dep || dep.userId !== u.id) return res.status(404).json({ error: "Deposit not found." });
  if (dep.withdrawnAt) return res.status(400).json({ error: "Already withdrawn." });
  if (new Date(dep.maturesAt).getTime() > Date.now()) {
    return res.status(400).json({ error: "Deposit has not matured yet." });
  }
  const payout = dep.amount + Math.round(dep.amount * dep.interestRate);
  await db.update(bankDepositsTable).set({ withdrawnAt: new Date() }).where(eq(bankDepositsTable.id, id));
  const updated = await db.update(usersTable)
    .set({ money: u.money + payout })
    .where(eq(usersTable.id, u.id))
    .returning();
  await logEvent(u.id, "bank", `Deposit matured: +$${payout} (interest +$${payout - dep.amount}).`, payout, { depositId: dep.id });
  res.json({ user: privateProfile(updated[0]!), payout });
});

export default router;
