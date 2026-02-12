import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const communityVisibilityEnum = pgEnum("community_visibility", [
  "public",
  "private",
]);

export const communityRoleEnum = pgEnum("community_role", [
  "owner",
  "moderator",
  "member",
]);

export const communities = pgTable("communities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description").notNull().default(""),
  avatarUrl: varchar("avatar_url", { length: 2048 }),
  coverUrl: varchar("cover_url", { length: 2048 }),
  visibility: communityVisibilityEnum("visibility").notNull().default("public"),
  postApproval: boolean("post_approval").notNull().default(false),
  actorUri: varchar("actor_uri", { length: 2048 }).notNull().unique(),
  inboxUri: varchar("inbox_uri", { length: 2048 }).notNull(),
  outboxUri: varchar("outbox_uri", { length: 2048 }).notNull(),
  followersUri: varchar("followers_uri", { length: 2048 }).notNull(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const communityMembers = pgTable("community_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => communities.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: communityRoleEnum("role").notNull().default("member"),
  approved: boolean("approved").notNull().default(true),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
