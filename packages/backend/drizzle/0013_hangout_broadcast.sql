ALTER TABLE "hangouts" ADD COLUMN "youtube_broadcast_id" varchar(128);
ALTER TABLE "hangouts" ADD COLUMN "broadcast_post_id" uuid REFERENCES "posts"("id") ON DELETE SET NULL;
