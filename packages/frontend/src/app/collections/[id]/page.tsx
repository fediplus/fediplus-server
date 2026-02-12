"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PostCard } from "@/components/feed/PostCard";
import type { StreamPost } from "@/stores/feed";
import { apiFetch } from "@/hooks/useApi";
import styles from "./page.module.css";

interface Collection {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  itemCount: number;
  owner: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}

interface CollectionItem {
  id: string;
  postId: string;
  position: number;
  post: StreamPost;
}

export default function CollectionDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      apiFetch<Collection>(`/api/v1/collections/${id}`).then(setCollection),
      apiFetch<{ items: CollectionItem[]; cursor: string | null }>(
        `/api/v1/collections/${id}/items`
      ).then((d) => {
        setItems(d.items);
        setCursor(d.cursor);
      }),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function loadMore() {
    if (!cursor) return;
    const data = await apiFetch<{
      items: CollectionItem[];
      cursor: string | null;
    }>(`/api/v1/collections/${id}/items?cursor=${cursor}`);
    setItems((prev) => [...prev, ...data.items]);
    setCursor(data.cursor);
  }

  if (loading) return <p role="status">Loading...</p>;
  if (!collection) return <p>Collection not found.</p>;

  return (
    <div className={styles.container}>
      <Card className={styles.headerCard} elevation={2}>
        <h1 className={styles.name}>{collection.name}</h1>
        {collection.owner && (
          <p className={styles.owner}>
            by {collection.owner.displayName}
          </p>
        )}
        {collection.description && (
          <p className={styles.description}>{collection.description}</p>
        )}
        <p className={styles.meta}>
          {collection.itemCount}{" "}
          {collection.itemCount === 1 ? "item" : "items"}
        </p>
      </Card>

      <section aria-label="Collection items">
        {items.length === 0 ? (
          <p className={styles.empty}>This collection is empty.</p>
        ) : (
          <div className={styles.postList}>
            {items.map((item) => (
              <PostCard key={item.id} post={item.post} />
            ))}
          </div>
        )}

        {cursor && (
          <div className={styles.loadMore}>
            <Button variant="secondary" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
