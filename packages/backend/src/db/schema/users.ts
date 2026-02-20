import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const actorTypeEnum = pgEnum("actor_type", [
  "Person",
  "Group",
  "Service",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 30 }).notNull().unique(),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  isLocal: boolean("is_local").notNull().default(true),
  domain: varchar("domain", { length: 255 }),
  actorType: actorTypeEnum("actor_type").notNull().default("Person"),
  actorUri: varchar("actor_uri", { length: 2048 }).notNull().unique(),
  inboxUri: varchar("inbox_uri", { length: 2048 }).notNull(),
  outboxUri: varchar("outbox_uri", { length: 2048 }).notNull(),
  followersUri: varchar("followers_uri", { length: 2048 }).notNull(),
  followingUri: varchar("following_uri", { length: 2048 }).notNull(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key"),
  encryptionPublicKey: text("encryption_public_key"),
  encryptionPrivateKeyEnc: text("encryption_private_key_enc"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 100 }).notNull().default(""),
  bio: text("bio").notNull().default(""),
  avatarUrl: varchar("avatar_url", { length: 2048 }),
  coverUrl: varchar("cover_url", { length: 2048 }),
  fields: text("fields").notNull().default("[]"),
  location: varchar("location", { length: 100 }),
  website: varchar("website", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
