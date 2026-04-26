import { Router, type IRouter } from "express";
import { db, usersTable, inventoryTable, tradesTable, transfersTable, attacksTable, missionsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authMiddleware, adminOnly, devOnly, type AuthedRequest, adminView } from "../lib/auth";
import { itemById } from "../lib/catalog";

const router: IRouter = Router();

router.use(authMiddleware, adminOnly);

router.get("/admin/users", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.lastSeen));
  res.json({ users: users.map(adminView) });
});

router.get("/admin/users/:id", async (req, res) => {
  const r = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id!)).limit(1);
  if (!r[0]) return res.status(404).json({ error: "Not found" });
  const inv = await db.select().from(inventoryTable).where(eq(inventoryTable.userId, r[0].id));
  const enriched = inv.map((row) => ({ ...row, item: itemById(row.itemId) }));
  res.json({ user: adminView(r[0]), inventory: enriched });
});

router.get("/admin/trades", async (_req, res) => {
  const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt)).limit(100);
  res.json({ trades });
});

router.get("/admin/transfers", async (_req, res) => {
  const transfers = await db.select().from(transfersTable).orderBy(desc(transfersTable.createdAt)).limit(100);
  res.json({ transfers });
});

router.get("/admin/attacks", async (_req, res) => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt)).limit(100);
  res.json({ attacks });
});

// Grant money/items
router.post("/admin/grant", async (req: AuthedRequest, res) => {
  const { userId, money, itemId, qty } = req.body || {};
  const r = await db.select().from(usersTable).where(eq(usersTable.id, String(userId || ""))).limit(1);
  if (!r[0]) return res.status(404).json({ error: "User not found" });
  if (typeof money === "number" && Number.isFinite(money)) {
    await db.update(usersTable).set({ money: Math.max(0, r[0].money + Math.floor(money)) }).where(eq(usersTable.id, r[0].id));
  }
  if (itemId && itemById(String(itemId))) {
    const q = Math.max(1, Math.floor(Number(qty || 1)));
    const itemIdStr = String(itemId);
    const ex = await db
      .select()
      .from(inventoryTable)
      .where(
        and(
          eq(inventoryTable.userId, r[0].id),
          eq(inventoryTable.itemId, itemIdStr),
        ),
      )
      .limit(1);
    const existing = ex[0];
    if (existing) {
      await db
        .update(inventoryTable)
        .set({ quantity: existing.quantity + q })
        .where(
          and(
            eq(inventoryTable.userId, r[0].id),
            eq(inventoryTable.itemId, itemIdStr),
          ),
        );
    } else {
      await db
        .insert(inventoryTable)
        .values({ userId: r[0].id, itemId: itemIdStr, quantity: q });
    }
  }
  res.json({ ok: true, message: "Granted." });
});

// Heal/punish
router.post("/admin/punish", async (req, res) => {
  const { userId, hospitalSeconds, jailSeconds, healFull } = req.body || {};
  const r = await db.select().from(usersTable).where(eq(usersTable.id, String(userId || ""))).limit(1);
  if (!r[0]) return res.status(404).json({ error: "User not found" });
  const updates: Record<string, unknown> = {};
  if (hospitalSeconds && Number(hospitalSeconds) > 0) updates.hospitalUntil = new Date(Date.now() + Math.floor(Number(hospitalSeconds)) * 1000);
  if (jailSeconds && Number(jailSeconds) > 0) updates.jailUntil = new Date(Date.now() + Math.floor(Number(jailSeconds)) * 1000);
  if (healFull) {
    updates.health = r[0].maxHealth;
    updates.energy = r[0].maxEnergy;
    updates.nerve = r[0].maxNerve;
    updates.happy = r[0].maxHappy;
    updates.hospitalUntil = null;
    updates.jailUntil = null;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to do." });
  await db.update(usersTable).set(updates).where(eq(usersTable.id, r[0].id));
  res.json({ ok: true });
});

// Promote / demote (dev only)
router.post("/admin/role", devOnly, async (req: AuthedRequest, res) => {
  const { userId, role } = req.body || {};
  if (!["player", "admin"].includes(String(role))) return res.status(400).json({ error: "Role must be 'player' or 'admin'." });
  const target = await db.select().from(usersTable).where(eq(usersTable.id, String(userId || ""))).limit(1);
  if (!target[0]) return res.status(404).json({ error: "User not found" });
  if (target[0].role === "dev") return res.status(400).json({ error: "Cannot change developer role." });
  await db.update(usersTable).set({ role }).where(eq(usersTable.id, target[0].id));
  res.json({ ok: true });
});

// Hard delete a user (dev only)
router.delete("/admin/users/:id", devOnly, async (req: AuthedRequest, res) => {
  const target = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id!)).limit(1);
  if (!target[0]) return res.status(404).json({ error: "Not found" });
  if (target[0].role === "dev") return res.status(400).json({ error: "Can't delete a developer account." });
  await db.delete(usersTable).where(eq(usersTable.id, req.params.id!));
  res.json({ ok: true });
});

export default router;
