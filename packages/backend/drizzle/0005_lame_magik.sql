CREATE TYPE "public"."hangout_status" AS ENUM('waiting', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."hangout_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "hangout_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hangout_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"is_muted" boolean DEFAULT false NOT NULL,
	"is_camera_off" boolean DEFAULT false NOT NULL,
	"is_screen_sharing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hangouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100),
	"visibility" "hangout_visibility" DEFAULT 'public' NOT NULL,
	"status" "hangout_status" DEFAULT 'waiting' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"max_participants" integer DEFAULT 10 NOT NULL,
	"rtmp_url" varchar(2048),
	"rtmp_active" boolean DEFAULT false NOT NULL,
	"ap_id" varchar(2048),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hangouts_ap_id_unique" UNIQUE("ap_id")
);
--> statement-breakpoint
ALTER TABLE "hangout_participants" ADD CONSTRAINT "hangout_participants_hangout_id_hangouts_id_fk" FOREIGN KEY ("hangout_id") REFERENCES "public"."hangouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hangout_participants" ADD CONSTRAINT "hangout_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hangouts" ADD CONSTRAINT "hangouts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;