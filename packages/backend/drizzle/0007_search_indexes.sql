-- Enable the pg_trgm extension for fuzzy / typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- ── Posts: full-text search column + GIN index ──
ALTER TABLE "posts" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(content, '') || ' ' || coalesce(hashtags, ''))
  ) STORED;--> statement-breakpoint
CREATE INDEX "posts_search_idx" ON "posts" USING GIN ("search_tsv");--> statement-breakpoint

-- ── Profiles: trigram index on display_name for fuzzy user search ──
CREATE INDEX "profiles_display_name_trgm_idx" ON "profiles" USING GIN ("display_name" gin_trgm_ops);--> statement-breakpoint

-- ── Users: trigram index on username for fuzzy user search ──
CREATE INDEX "users_username_trgm_idx" ON "users" USING GIN ("username" gin_trgm_ops);--> statement-breakpoint

-- ── Communities: full-text search column + GIN index ──
ALTER TABLE "communities" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
  ) STORED;--> statement-breakpoint
CREATE INDEX "communities_search_idx" ON "communities" USING GIN ("search_tsv");--> statement-breakpoint

-- ── Communities: trigram index on name for fuzzy matching ──
CREATE INDEX "communities_name_trgm_idx" ON "communities" USING GIN ("name" gin_trgm_ops);--> statement-breakpoint

-- ── Hashtags: index posts hashtags column for fast LIKE searches ──
CREATE INDEX "posts_hashtags_idx" ON "posts" USING GIN ("hashtags" gin_trgm_ops);
