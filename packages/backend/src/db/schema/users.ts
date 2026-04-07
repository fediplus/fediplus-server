import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

export const actorTypeEnum = pgEnum("actor_type", [
  "Person",
  "Group",
  "Service",
]);

export const tokenTypeEnum = pgEnum("token_type", [
  "verification",
  "reset",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 30 }).notNull().unique(),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  emailVerified: boolean("email_verified").notNull().default(false),
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
  role: varchar("role", { length: 20 }).notNull().default("user"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  silenced: boolean("silenced").notNull().default(false),
  sensitized: boolean("sensitized").notNull().default(false),
  permissions: jsonb("permissions").notNull().default({
    can_post: true,
    can_comment: true,
    can_follow: true,
    can_react: true,
    can_upload: true,
    can_message: true,
    can_report: true,
    can_create_communities: true,
  }),
  adminNote: text("admin_note"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const emailTokens = pgTable("email_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  type: tokenTypeEnum("type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
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
