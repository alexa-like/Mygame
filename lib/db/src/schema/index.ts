import { pgTable, text, integer, real, timestamp, uuid, primaryKey, jsonb, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  token: text("token").notNull().unique(),
  email: text("email").notNull().default(""),
  gender: text("gender").notNull().default(""),
  avatarUrl: text("avatar_url").notNull().default(""),
  role: text("role").notNull().default("player"), // 'player' | 'admin' | 'dev'

  bio: text("bio").notNull().default(""),
  avatar: text("avatar").notNull().default("purple"),

  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  money: integer("money").notNull().default(500),
  respect: integer("respect").notNull().default(0),

  health: integer("health").notNull().default(100),
  maxHealth: integer("max_health").notNull().default(100),
  energy: integer("energy").notNull().default(100),
  maxEnergy: integer("max_energy").notNull().default(100),
  nerve: integer("nerve").notNull().default(25),
  maxNerve: integer("max_nerve").notNull().default(25),
  happy: integer("happy").notNull().default(250),
  maxHappy: integer("max_happy").notNull().default(250),

  strength: real("strength").notNull().default(10),
  defense: real("defense").notNull().default(10),
  speed: real("speed").notNull().default(10),
  dexterity: real("dexterity").notNull().default(10),

  location: text("location").notNull().default("neo_torin"),
  travelFromCity: text("travel_from_city"),
  travelArrivalAt: timestamp("travel_arrival_at", { withTimezone: true }),
  hospitalUntil: timestamp("hospital_until", { withTimezone: true }),
  jailUntil: timestamp("jail_until", { withTimezone: true }),

  crimesCommitted: integer("crimes_committed").notNull().default(0),
  missionsCompleted: integer("missions_completed").notNull().default(0),
  attacksWon: integer("attacks_won").notNull().default(0),
  attacksLost: integer("attacks_lost").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  lastRegenAt: timestamp("last_regen_at", { withTimezone: true }).notNull().defaultNow(),

  // Self-delete grace period (60 min). When set, user is logged out; if not undone in time, account is purged.
  pendingDeleteAt: timestamp("pending_delete_at", { withTimezone: true }),

  // Daily reward streak
  lastDailyClaimAt: timestamp("last_daily_claim_at", { withTimezone: true }),
  dailyStreak: integer("daily_streak").notNull().default(0),

  // Soft-bank balance (interest-bearing deposits live in bank_deposits)
  bankBalance: integer("bank_balance").notNull().default(0),
});

export type User = typeof usersTable.$inferSelect;

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromUserId: uuid("from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Message = typeof messagesTable.$inferSelect;

export const inventoryTable = pgTable("inventory", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.itemId] }) }));
export type InventoryRow = typeof inventoryTable.$inferSelect;

export const attacksTable = pgTable("attacks", {
  id: uuid("id").primaryKey().defaultRandom(),
  attackerId: uuid("attacker_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  defenderId: uuid("defender_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  winnerId: uuid("winner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  moneyStolen: integer("money_stolen").notNull().default(0),
  respectGained: integer("respect_gained").notNull().default(0),
  damageDealt: integer("damage_dealt").notNull().default(0),
  log: text("log").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Attack = typeof attacksTable.$inferSelect;

// Money transfers (audit log)
export const transfersTable = pgTable("transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromUserId: uuid("from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Transfer = typeof transfersTable.$inferSelect;

// Trade proposals (item+money for item+money)
// items shape: [{ itemId: string, quantity: number }, ...]
export const tradesTable = pgTable("trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromUserId: uuid("from_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  offerMoney: integer("offer_money").notNull().default(0),
  offerItems: jsonb("offer_items").notNull().default("[]"),
  wantMoney: integer("want_money").notNull().default(0),
  wantItems: jsonb("want_items").notNull().default("[]"),
  status: text("status").notNull().default("pending"), // pending|accepted|rejected|cancelled|expired
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
export type Trade = typeof tradesTable.$inferSelect;

// Active mission instances (time-gated)
export const missionsTable = pgTable("missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  difficulty: text("difficulty").notNull(),
  energyCost: integer("energy_cost").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  moneyReward: integer("money_reward").notNull(),
  xpReward: integer("xp_reward").notNull(),
  status: text("status").notNull().default("available"), // available|in_progress|completed|failed
  startedAt: timestamp("started_at", { withTimezone: true }),
  completesAt: timestamp("completes_at", { withTimezone: true }),
  claimed: boolean("claimed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MissionRow = typeof missionsTable.$inferSelect;

// Bank deposits (term deposits with interest)
export const bankDepositsTable = pgTable("bank_deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  durationDays: integer("duration_days").notNull(), // 1 | 7 | 30
  interestRate: real("interest_rate").notNull(),    // e.g. 0.02 / 0.08 / 0.25
  depositedAt: timestamp("deposited_at", { withTimezone: true }).notNull().defaultNow(),
  maturesAt: timestamp("matures_at", { withTimezone: true }).notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
});
export type BankDeposit = typeof bankDepositsTable.$inferSelect;

// Player-facing event log (works offline; stored server-side)
export const eventsTable = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // attack | money_in | money_out | levelup | daily | bank | trade | mission
  text: text("text").notNull(),
  amount: integer("amount").notNull().default(0),
  meta: jsonb("meta").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type EventRow = typeof eventsTable.$inferSelect;
