import { db, usersTable, inventoryTable, tradesTable, transfersTable, type User, type Trade } from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { itemById } from "./catalog";

export interface ItemEntry { itemId: string; quantity: number }

function normalizeItems(items: unknown): ItemEntry[] {
  if (!Array.isArray(items)) return [];
  const out: ItemEntry[] = [];
  for (const it of items) {
    if (it && typeof it === "object" && typeof (it as any).itemId === "string") {
      const qty = Math.floor(Number((it as any).quantity || 0));
      if (qty > 0 && itemById((it as any).itemId)) out.push({ itemId: (it as any).itemId, quantity: qty });
    }
  }
  // Merge duplicates
  const map = new Map<string, number>();
  for (const e of out) map.set(e.itemId, (map.get(e.itemId) || 0) + e.quantity);
  return [...map.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

export async function transferMoney(from: User, toUserId: string, amount: number, note: string): Promise<{ ok: true; newFromMoney: number } | { error: string }> {
  if (from.id === toUserId) return { error: "Can't send to yourself." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Invalid amount." };
  amount = Math.floor(amount);
  if (amount > from.money) return { error: "Insufficient funds." };
  const toRows = await db.select().from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
  if (!toRows[0]) return { error: "Recipient not found." };
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ money: from.money - amount }).where(eq(usersTable.id, from.id));
    await tx.update(usersTable).set({ money: toRows[0]!.money + amount }).where(eq(usersTable.id, toUserId));
    await tx.insert(transfersTable).values({ fromUserId: from.id, toUserId, amount, note: String(note || "").slice(0, 200) });
  });
  return { ok: true, newFromMoney: from.money - amount };
}

export async function recentTransfers(userId: string) {
  const rows = await db.select().from(transfersTable)
    .where(or(eq(transfersTable.fromUserId, userId), eq(transfersTable.toUserId, userId)))
    .orderBy(desc(transfersTable.createdAt)).limit(30);
  return rows;
}

export async function createTrade(from: User, payload: { toUserId: string; offerMoney?: number; offerItems?: unknown; wantMoney?: number; wantItems?: unknown; message?: string }) {
  if (payload.toUserId === from.id) return { error: "Can't trade with yourself." };
  const toRows = await db.select().from(usersTable).where(eq(usersTable.id, payload.toUserId)).limit(1);
  if (!toRows[0]) return { error: "Recipient not found." };
  const offerMoney = Math.max(0, Math.floor(Number(payload.offerMoney || 0)));
  const wantMoney = Math.max(0, Math.floor(Number(payload.wantMoney || 0)));
  const offerItems = normalizeItems(payload.offerItems);
  const wantItems = normalizeItems(payload.wantItems);
  if (offerMoney === 0 && offerItems.length === 0 && wantMoney === 0 && wantItems.length === 0) {
    return { error: "Trade must include at least one offer or request." };
  }
  if (offerMoney > from.money) return { error: "You don't have that much money to offer." };
  // Verify offered items exist in proposer's inventory
  for (const it of offerItems) {
    const inv = await db.select().from(inventoryTable).where(and(eq(inventoryTable.userId, from.id), eq(inventoryTable.itemId, it.itemId))).limit(1);
    if (!inv[0] || inv[0].quantity < it.quantity) return { error: `You don't have ${it.quantity}× ${itemById(it.itemId)?.name || it.itemId}.` };
  }
  const inserted = await db.insert(tradesTable).values({
    fromUserId: from.id,
    toUserId: payload.toUserId,
    offerMoney, offerItems: offerItems as any,
    wantMoney, wantItems: wantItems as any,
    message: String(payload.message || "").slice(0, 200),
  }).returning();
  return { ok: true, trade: inserted[0]! };
}

export async function listTradesFor(userId: string) {
  const incoming = await db.select().from(tradesTable)
    .where(and(eq(tradesTable.toUserId, userId), eq(tradesTable.status, "pending")))
    .orderBy(desc(tradesTable.createdAt));
  const outgoing = await db.select().from(tradesTable)
    .where(and(eq(tradesTable.fromUserId, userId), eq(tradesTable.status, "pending")))
    .orderBy(desc(tradesTable.createdAt));
  const history = await db.select().from(tradesTable)
    .where(and(or(eq(tradesTable.fromUserId, userId), eq(tradesTable.toUserId, userId))))
    .orderBy(desc(tradesTable.createdAt)).limit(20);
  return { incoming, outgoing, history };
}

async function adjustInventory(tx: any, userId: string, itemId: string, delta: number) {
  const ex = await tx.select().from(inventoryTable).where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId))).limit(1);
  const cur = ex[0]?.quantity || 0;
  const next = cur + delta;
  if (next < 0) throw new Error(`insufficient ${itemId}`);
  if (ex[0]) {
    if (next === 0) await tx.delete(inventoryTable).where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId)));
    else await tx.update(inventoryTable).set({ quantity: next }).where(and(eq(inventoryTable.userId, userId), eq(inventoryTable.itemId, itemId)));
  } else if (next > 0) {
    await tx.insert(inventoryTable).values({ userId, itemId, quantity: next });
  }
}

export async function acceptTrade(acceptor: User, tradeId: string): Promise<{ ok: true } | { error: string }> {
  const rows = await db.select().from(tradesTable).where(eq(tradesTable.id, tradeId)).limit(1);
  const trade = rows[0];
  if (!trade) return { error: "Trade not found." };
  if (trade.status !== "pending") return { error: "Trade is no longer pending." };
  if (trade.toUserId !== acceptor.id) return { error: "You can't accept this trade." };

  const offerItems = trade.offerItems as ItemEntry[];
  const wantItems = trade.wantItems as ItemEntry[];

  try {
    await db.transaction(async (tx) => {
      const fromR = await tx.select().from(usersTable).where(eq(usersTable.id, trade.fromUserId)).limit(1);
      const toR = await tx.select().from(usersTable).where(eq(usersTable.id, trade.toUserId)).limit(1);
      const proposer = fromR[0]; const recipient = toR[0];
      if (!proposer || !recipient) throw new Error("Users gone");

      if (proposer.money < trade.offerMoney) throw new Error("Proposer no longer has the offered money.");
      if (recipient.money < trade.wantMoney) throw new Error("You don't have the requested money.");

      // Verify items both ways
      for (const it of offerItems) {
        const inv = await tx.select().from(inventoryTable).where(and(eq(inventoryTable.userId, proposer.id), eq(inventoryTable.itemId, it.itemId))).limit(1);
        if (!inv[0] || inv[0].quantity < it.quantity) throw new Error(`Proposer no longer has ${itemById(it.itemId)?.name}.`);
      }
      for (const it of wantItems) {
        const inv = await tx.select().from(inventoryTable).where(and(eq(inventoryTable.userId, recipient.id), eq(inventoryTable.itemId, it.itemId))).limit(1);
        if (!inv[0] || inv[0].quantity < it.quantity) throw new Error(`You don't have ${it.quantity}× ${itemById(it.itemId)?.name}.`);
      }

      // Atomic swap
      await tx.update(usersTable).set({ money: proposer.money - trade.offerMoney + trade.wantMoney }).where(eq(usersTable.id, proposer.id));
      await tx.update(usersTable).set({ money: recipient.money + trade.offerMoney - trade.wantMoney }).where(eq(usersTable.id, recipient.id));

      for (const it of offerItems) {
        await adjustInventory(tx, proposer.id, it.itemId, -it.quantity);
        await adjustInventory(tx, recipient.id, it.itemId, +it.quantity);
      }
      for (const it of wantItems) {
        await adjustInventory(tx, recipient.id, it.itemId, -it.quantity);
        await adjustInventory(tx, proposer.id, it.itemId, +it.quantity);
      }

      await tx.update(tradesTable).set({ status: "accepted", resolvedAt: new Date() }).where(eq(tradesTable.id, trade.id));
    });
  } catch (e: any) {
    await db.update(tradesTable).set({ status: "rejected", resolvedAt: new Date() }).where(eq(tradesTable.id, trade.id));
    return { error: e.message || "Trade failed." };
  }
  return { ok: true };
}

export async function rejectTrade(user: User, tradeId: string): Promise<{ ok: true } | { error: string }> {
  const rows = await db.select().from(tradesTable).where(eq(tradesTable.id, tradeId)).limit(1);
  const trade = rows[0];
  if (!trade || trade.status !== "pending") return { error: "Trade not pending." };
  if (trade.toUserId !== user.id && trade.fromUserId !== user.id) return { error: "Not your trade." };
  const status = trade.fromUserId === user.id ? "cancelled" : "rejected";
  await db.update(tradesTable).set({ status, resolvedAt: new Date() }).where(eq(tradesTable.id, tradeId));
  return { ok: true };
}
