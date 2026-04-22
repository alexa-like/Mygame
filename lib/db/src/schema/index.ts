import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  token: text("token").notNull().unique(),
  bio: text("bio").notNull().default(""),
  avatar: text("avatar").notNull().default("default"),
  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  money: integer("money").notNull().default(100),
  health: integer("health").notNull().default(100),
  energy: integer("energy").notNull().default(100),
  maxHealth: integer("max_health").notNull().default(100),
  maxEnergy: integer("max_energy").notNull().default(100),
  crimesCommitted: integer("crimes_committed").notNull().default(0),
  missionsCompleted: integer("missions_completed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
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
