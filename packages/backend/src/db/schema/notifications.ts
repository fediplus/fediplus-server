import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "follow",
  "follow_accepted",
  "reaction",
  "comment",
  "mention",
  "reshare",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetId: uuid("target_id"),
  targetType: varchar("target_type", { length: 50 }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
