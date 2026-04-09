DO $$ BEGIN
 CREATE TYPE "public"."streaming_platform" AS ENUM('youtube', 'twitch', 'owncast', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "streaming_destinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "platform" "streaming_platform" DEFAULT 'custom' NOT NULL,
  "rtmp_url" varchar(2048) NOT NULL,
  "stream_key" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "streaming_destinations" ADD CONSTRAINT "streaming_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "streaming_dest_user_idx" ON "streaming_destinations" USING btree ("user_id");
