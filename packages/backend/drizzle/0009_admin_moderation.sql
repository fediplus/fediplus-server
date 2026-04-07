-- Add role, status, permissions, and moderation fields to users
ALTER TABLE "users" ADD COLUMN "role" varchar(20) NOT NULL DEFAULT 'user';
ALTER TABLE "users" ADD COLUMN "status" varchar(20) NOT NULL DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN "silenced" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "sensitized" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "permissions" jsonb NOT NULL DEFAULT '{"can_post":true,"can_comment":true,"can_follow":true,"can_react":true,"can_upload":true,"can_message":true,"can_report":true,"can_create_communities":true}';
ALTER TABLE "users" ADD COLUMN "admin_note" text;
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "suspension_reason" text;

-- Enums for admin/moderation
DO $$ BEGIN
  CREATE TYPE "report_type" AS ENUM ('spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'copyright', 'impersonation', 'misinformation', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "report_target_type" AS ENUM ('post', 'user', 'comment', 'community', 'message');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "report_status" AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "moderation_action" AS ENUM ('warn', 'silence', 'suspend', 'unsuspend', 'disable', 'enable', 'delete_post', 'hide_post', 'unhide_post', 'mark_sensitive', 'delete_comment', 'dismiss_report', 'resolve_report', 'block_domain', 'unblock_domain', 'silence_domain', 'unsilence_domain', 'update_permissions', 'update_role', 'update_settings', 'update_notes');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "domain_severity" AS ENUM ('silence', 'suspend', 'noop');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ip_block_severity" AS ENUM ('sign_up_requires_approval', 'sign_up_block', 'no_access');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "user_role" AS ENUM ('user', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'disabled', 'pending');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Reports table
CREATE TABLE IF NOT EXISTS "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reporter_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_type" "report_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "target_account_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "type" "report_type" NOT NULL,
  "comment" text NOT NULL DEFAULT '',
  "status" "report_status" NOT NULL DEFAULT 'open',
  "assigned_mod_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Appeals table
CREATE TABLE IF NOT EXISTS "appeals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "report_id" uuid NOT NULL REFERENCES "reports"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rejected_at" timestamp with time zone,
  "rejected_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- User warnings table
CREATE TABLE IF NOT EXISTS "user_warnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_account_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" "moderation_action" NOT NULL,
  "text" text NOT NULL DEFAULT '',
  "report_id" uuid REFERENCES "reports"("id") ON DELETE SET NULL,
  "created_by_mod_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" "moderation_action" NOT NULL,
  "target_type" varchar(50) NOT NULL,
  "target_id" varchar(255) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Domain blocks table
CREATE TABLE IF NOT EXISTS "domain_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "domain" varchar(255) NOT NULL UNIQUE,
  "severity" "domain_severity" NOT NULL DEFAULT 'silence',
  "public_comment" text,
  "private_comment" text,
  "reject_media" boolean NOT NULL DEFAULT false,
  "reject_reports" boolean NOT NULL DEFAULT false,
  "obfuscate" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- IP blocks table
CREATE TABLE IF NOT EXISTS "ip_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ip" inet NOT NULL,
  "severity" "ip_block_severity" NOT NULL,
  "comment" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Admin settings (key-value store)
CREATE TABLE IF NOT EXISTS "admin_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(100) NOT NULL UNIQUE,
  "value" jsonb,
  "type" varchar(20) NOT NULL DEFAULT 'string',
  "is_public" boolean NOT NULL DEFAULT false,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Admin access logs (security)
CREATE TABLE IF NOT EXISTS "admin_access_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "ip" inet NOT NULL,
  "user_agent" text,
  "route" varchar(500) NOT NULL,
  "method" varchar(10) NOT NULL,
  "status_code" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_reports_status" ON "reports" ("status");
CREATE INDEX IF NOT EXISTS "idx_reports_reporter" ON "reports" ("reporter_id");
CREATE INDEX IF NOT EXISTS "idx_reports_target" ON "reports" ("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "idx_reports_assigned" ON "reports" ("assigned_mod_id") WHERE "assigned_mod_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_appeals_report" ON "appeals" ("report_id");
CREATE INDEX IF NOT EXISTS "idx_appeals_account" ON "appeals" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_actor" ON "audit_logs" ("actor_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_user_warnings_target" ON "user_warnings" ("target_account_id");
CREATE INDEX IF NOT EXISTS "idx_domain_blocks_domain" ON "domain_blocks" ("domain");
CREATE INDEX IF NOT EXISTS "idx_ip_blocks_ip" ON "ip_blocks" ("ip");
CREATE INDEX IF NOT EXISTS "idx_ip_blocks_expires" ON "ip_blocks" ("expires_at") WHERE "expires_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_admin_access_logs_created" ON "admin_access_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users" ("role");
CREATE INDEX IF NOT EXISTS "idx_users_status" ON "users" ("status");
