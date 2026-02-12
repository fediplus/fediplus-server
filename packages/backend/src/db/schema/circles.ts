import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const circles = pgTable("circles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#4285f4"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const circleMembers = pgTable("circle_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  circleId: uuid("circle_id")
    .notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
