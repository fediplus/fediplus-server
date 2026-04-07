import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isGroup: boolean("is_group").notNull().default(false),
  name: varchar("name", { length: 100 }),
  encrypted: boolean("encrypted").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const conversationParticipants = pgTable("conversation_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  ephemeralPublicKey: text("ephemeral_public_key"),
  iv: varchar("iv", { length: 32 }).notNull(),
  epoch: integer("epoch").notNull().default(0),
  mlsCounter: integer("mls_counter"),
  apId: varchar("ap_id", { length: 2048 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── MLS Key Packages (one-time prekeys) ──

export const mlsKeyPackages = pgTable("mls_key_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  keyData: text("key_data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// ── MLS Group State (per-member encrypted group secret per epoch) ──

export const mlsGroupState = pgTable(
  "mls_group_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    epoch: integer("epoch").notNull().default(0),
    encryptedState: text("encrypted_state").notNull(),
    initiatorId: uuid("initiator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    keyPackageId: uuid("key_package_id").references(() => mlsKeyPackages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.conversationId, table.userId, table.epoch)]
);
