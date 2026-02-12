import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const postVisibilityEnum = pgEnum("post_visibility", [
  "public",
  "circles",
  "followers",
  "direct",
]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  visibility: postVisibilityEnum("visibility").notNull().default("public"),
  apId: varchar("ap_id", { length: 2048 }).unique(),
  replyToId: uuid("reply_to_id"),
  reshareOfId: uuid("reshare_of_id"),
  hashtags: text("hashtags").notNull().default("[]"),
  mentions: text("mentions").notNull().default("[]"),
  sensitive: boolean("sensitive").notNull().default(false),
  spoilerText: varchar("spoiler_text", { length: 200 }),
  editHistory: text("edit_history").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const audienceFieldEnum = pgEnum("audience_field", [
  "to",
  "cc",
  "bto",
  "bcc",
]);
export const audienceTargetTypeEnum = pgEnum("audience_target_type", [
  "circle",
  "user",
  "public",
  "followers",
]);

export const postAudiences = pgTable("post_audiences", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  targetType: audienceTargetTypeEnum("target_type").notNull(),
  targetId: varchar("target_id", { length: 2048 }),
  field: audienceFieldEnum("field").notNull(),
});

export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 10 }).notNull().default("+1"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
