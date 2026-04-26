import { db, eventsTable, type EventRow } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export type EventKind =
  | "attack" | "money_in" | "money_out" | "levelup" | "daily"
  | "bank" | "trade" | "mission" | "shop" | "system";

export async function logEvent(userId: string, kind: EventKind, text: string, amount = 0, meta: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.insert(eventsTable).values({ userId, kind, text, amount, meta: meta as any });
  } catch {
    // Logging must never break gameplay.
  }
}

export async function listEvents(userId: string, limit = 50): Promise<EventRow[]> {
  return db.select().from(eventsTable).where(eq(eventsTable.userId, userId)).orderBy(desc(eventsTable.createdAt)).limit(limit);
}
