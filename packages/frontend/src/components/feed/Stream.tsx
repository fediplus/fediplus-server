"use client";

import { useEffect, useCallback, useState } from "react";
import { PostCard } from "./PostCard";
import { CommentThread } from "./CommentThread";
import { Button } from "@/components/ui/Button";
import { useFeedStore, type StreamPost } from "@/stores/feed";
import { useNotificationStore } from "@/stores/notifications";
import { useAuthStore } from "@/stores/auth";
import { useSSE } from "@/hooks/useSSE";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./Stream.module.css";

interface Circle {
  id: string;
  name: string;
  color: string;
}

export function Stream() {
  const user = useAuthStore((s) => s.user);
  const {
    posts,
    cursor,
    loading,
    circleFilter,
    setPosts,
    appendPosts,
    prependPost,
    setLoading,
    setCircleFilter,
  } = useFeedStore();
  const { incrementUnread } = useNotificationStore();

  const [expandedComments, setExpandedComments] = useState<Set<string>>(
    new Set()
  );
  const [circles, setCircles] = useState<Circle[]>([]);

  // Load circles for filter tabs
  useEffect(() => {
    if (user) {
      apiFetch<Circle[]>("/api/v1/circles")
        .then(setCircles)
        .catch(() => {});
    }
  }, [user]);

  // Load stream
  const loadStream = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (circleFilter) params.set("circleId", circleFilter);
      const data = await apiFetch<{
        items: StreamPost[];
        cursor: string | null;
      }>(`/api/v1/stream?${params}`);
      setPosts(data.items, data.cursor);
    } catch {
      // Not logged in
    } finally {
      setLoading(false);
    }
  }, [user, circleFilter, setPosts, setLoading]);

  useEffect(() => {
    loadStream();
  }, [loadStream]);

  // SSE real-time updates
  useSSE(
    useCallback(
      (event: string, data: unknown) => {
        if (event === "new_post") {
          prependPost(data as StreamPost);
          announce("New post in your stream");
        } else if (event === "notification") {
          incrementUnread();
          announce("New notification");
        }
      },
      [prependPost, incrementUnread]
    )
  );

  async function loadMore() {
    if (!cursor || loading || !user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ cursor });
      if (circleFilter) params.set("circleId", circleFilter);
      const data = await apiFetch<{
        items: StreamPost[];
        cursor: string | null;
      }>(`/api/v1/stream?${params}`);
      appendPosts(data.items, data.cursor);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }

  function toggleComments(postId: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }

  return (
    <div className={styles.stream}>
      {/* Circle filter tabs */}
      {circles.length > 0 && (
        <nav className={styles.filterTabs} aria-label="Filter by circle">
          <Button
            variant={circleFilter === null ? "primary" : "ghost"}
            size="sm"
            onClick={() => setCircleFilter(null)}
            aria-pressed={circleFilter === null}
          >
            All
          </Button>
          {circles.map((circle) => (
            <Button
              key={circle.id}
              variant={circleFilter === circle.id ? "primary" : "ghost"}
              size="sm"
              onClick={() => setCircleFilter(circle.id)}
              aria-pressed={circleFilter === circle.id}
            >
              <span
                className={styles.circleDot}
                style={{ backgroundColor: circle.color }}
                aria-hidden="true"
              />
              {circle.name}
            </Button>
          ))}
        </nav>
      )}

      {/* Posts */}
      {posts.length === 0 && !loading && (
        <p className={styles.empty}>
          {circleFilter
            ? "No posts from people in this circle yet."
            : "Your stream is empty. Follow people or join communities to see posts here."}
        </p>
      )}

      {posts.map((post) => (
        <div key={post.id}>
          <PostCard
            post={post}
            onComment={() => toggleComments(post.id)}
          />
          {expandedComments.has(post.id) && (
            <CommentThread postId={post.id} />
          )}
        </div>
      ))}

      {/* Load more */}
      {cursor && (
        <div className={styles.loadMore}>
          <Button
            variant="secondary"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {loading && posts.length === 0 && (
        <p className={styles.loading} role="status">
          Loading stream...
        </p>
      )}
    </div>
  );
}
