import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const hangoutVisibilityEnum = pgEnum("hangout_visibility", [
  "public",
  "private",
]);

export const hangoutStatusEnum = pgEnum("hangout_status", [
  "waiting",
  "active",
  "ended",
]);

export const hangouts = pgTable("hangouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }),
  visibility: hangoutVisibilityEnum("visibility").notNull().default("public"),
  status: hangoutStatusEnum("status").notNull().default("waiting"),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  maxParticipants: integer("max_participants").notNull().default(10),
  rtmpUrl: varchar("rtmp_url", { length: 2048 }),
  rtmpActive: boolean("rtmp_active").notNull().default(false),
  apId: varchar("ap_id", { length: 2048 }).unique(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const hangoutParticipants = pgTable("hangout_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  hangoutId: uuid("hangout_id")
    .notNull()
    .references(() => hangouts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  isMuted: boolean("is_muted").notNull().default(false),
  isCameraOff: boolean("is_camera_off").notNull().default(false),
  isScreenSharing: boolean("is_screen_sharing").notNull().default(false),
});
