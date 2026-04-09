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

export const streamingPlatformEnum = pgEnum("streaming_platform", [
  "youtube",
  "twitch",
  "owncast",
  "custom",
]);

export const streamingDestinations = pgTable("streaming_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  platform: streamingPlatformEnum("platform").notNull().default("custom"),
  rtmpUrl: varchar("rtmp_url", { length: 2048 }).notNull(),
  streamKey: text("stream_key"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
