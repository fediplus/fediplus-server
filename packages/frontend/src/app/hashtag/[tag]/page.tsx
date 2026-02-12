"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PostCard } from "@/components/feed/PostCard";
import { Button } from "@/components/ui/Button";
import type { StreamPost } from "@/stores/feed";
import { apiFetch } from "@/hooks/useApi";
import styles from "./page.module.css";

export default function HashtagPage() {
  const params = useParams();
  const tag = params?.tag as string;
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tag) return;
    setLoading(true);
    apiFetch<{ items: StreamPost[]; cursor: string | null }>(
      `/api/v1/hashtags/${tag}/stream`
    )
      .then((data) => {
        setPosts(data.items);
        setCursor(data.cursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tag]);

  async function loadMore() {
    if (!cursor) return;
    const data = await apiFetch<{
      items: StreamPost[];
      cursor: string | null;
    }>(`/api/v1/hashtags/${tag}/stream?cursor=${cursor}`);
    setPosts((prev) => [...prev, ...data.items]);
    setCursor(data.cursor);
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>#{tag}</h1>

      {loading ? (
        <p role="status">Loading...</p>
      ) : posts.length === 0 ? (
        <p className={styles.empty}>No posts with this hashtag yet.</p>
      ) : (
        <>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          {cursor && (
            <div className={styles.loadMore}>
              <Button variant="secondary" onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
