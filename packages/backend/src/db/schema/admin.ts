import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  integer,
  jsonb,
  inet,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ── Enums ──

export const userRoleEnum = pgEnum("user_role", [
  "user",
  "moderator",
  "admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "disabled",
  "pending",
]);

export const reportTypeEnum = pgEnum("report_type", [
  "spam",
  "harassment",
  "hate_speech",
  "nudity",
  "violence",
  "copyright",
  "impersonation",
  "misinformation",
  "other",
]);

export const reportTargetTypeEnum = pgEnum("report_target_type", [
  "post",
  "user",
  "comment",
  "community",
  "message",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "open",
  "resolved",
  "dismissed",
]);

export const moderationActionEnum = pgEnum("moderation_action", [
  "warn",
  "silence",
  "suspend",
  "unsuspend",
  "disable",
  "enable",
  "delete_post",
  "hide_post",
  "unhide_post",
  "mark_sensitive",
  "delete_comment",
  "dismiss_report",
  "resolve_report",
  "block_domain",
  "unblock_domain",
  "silence_domain",
  "unsilence_domain",
  "update_permissions",
  "update_role",
  "update_settings",
  "update_notes",
]);

export const domainSeverityEnum = pgEnum("domain_severity", [
  "silence",
  "suspend",
  "noop",
]);

export const ipBlockSeverityEnum = pgEnum("ip_block_severity", [
  "sign_up_requires_approval",
  "sign_up_block",
  "no_access",
]);

// ── Reports ──

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetType: reportTargetTypeEnum("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  targetAccountId: uuid("target_account_id").references(() => users.id, {
    onDelete: "set null",
  }),
  type: reportTypeEnum("type").notNull(),
  comment: text("comment").notNull().default(""),
  status: reportStatusEnum("status").notNull().default("open"),
  assignedModId: uuid("assigned_mod_id").references(() => users.id, {
    onDelete: "set null",
  }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Appeals ──

export const appeals = pgTable("appeals", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedById: uuid("rejected_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── User Warnings ──

export const userWarnings = pgTable("user_warnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetAccountId: uuid("target_account_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: moderationActionEnum("action").notNull(),
  text: text("text").notNull().default(""),
  reportId: uuid("report_id").references(() => reports.id, {
    onDelete: "set null",
  }),
  createdByModId: uuid("created_by_mod_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Audit Log ──

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: moderationActionEnum("action").notNull(),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: varchar("target_id", { length: 255 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Domain Blocks ──

export const domainBlocks = pgTable("domain_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  severity: domainSeverityEnum("severity").notNull().default("silence"),
  publicComment: text("public_comment"),
  privateComment: text("private_comment"),
  rejectMedia: boolean("reject_media").notNull().default(false),
  rejectReports: boolean("reject_reports").notNull().default(false),
  obfuscate: boolean("obfuscate").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── IP Blocks ──

export const ipBlocks = pgTable("ip_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ip: inet("ip").notNull(),
  severity: ipBlockSeverityEnum("severity").notNull(),
  comment: text("comment"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Admin Settings (key-value store) ──

export const adminSettings = pgTable("admin_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: jsonb("value"),
  type: varchar("type", { length: 20 }).notNull().default("string"),
  isPublic: boolean("is_public").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Admin Access Log (security) ──

export const adminAccessLogs = pgTable("admin_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  ip: inet("ip").notNull(),
  userAgent: text("user_agent"),
  route: varchar("route", { length: 500 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  statusCode: integer("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
