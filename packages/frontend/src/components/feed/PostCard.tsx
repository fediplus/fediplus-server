"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { StreamPost } from "@/stores/feed";
import { useFeedStore } from "@/stores/feed";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./PostCard.module.css";

interface PostCardProps {
  post: StreamPost;
  onComment?: () => void;
}

export function PostCard({ post, onComment }: PostCardProps) {
  const updatePost = useFeedStore((s) => s.updatePost);
  const [reacting, setReacting] = useState(false);

  const timeAgo = formatTimeAgo(post.createdAt);
  const isEdited = post.editHistory.length > 0;

  async function handleReaction() {
    if (reacting) return;
    setReacting(true);

    try {
      if (post.userReacted) {
        await apiFetch(`/api/v1/posts/${post.id}/reactions`, {
          method: "DELETE",
        });
        updatePost(post.id, {
          userReacted: false,
          reactionCount: post.reactionCount - 1,
        });
        announce("+1 removed");
      } else {
        await apiFetch(`/api/v1/posts/${post.id}/reactions`, {
          method: "POST",
        });
        updatePost(post.id, {
          userReacted: true,
          reactionCount: post.reactionCount + 1,
        });
        announce("+1 added");
      }
    } catch {
      // Revert optimistic update on error
    } finally {
      setReacting(false);
    }
  }

  async function handleReshare() {
    try {
      await apiFetch(`/api/v1/posts/${post.id}/reshare`, { method: "POST" });
      updatePost(post.id, { reshareCount: post.reshareCount + 1 });
      announce("Post reshared");
    } catch {
      // Ignore
    }
  }

  return (
    <Card as="article" className={styles.card} aria-label={`Post by ${post.author.displayName}`}>
      {post.sensitive && post.spoilerText && (
        <p className={styles.spoiler}>{post.spoilerText}</p>
      )}

      <header className={styles.header}>
        <Link href={`/${post.author.username}`} className={styles.authorLink}>
          <div className={styles.avatar} aria-hidden="true">
            {post.author.displayName.charAt(0)}
          </div>
          <div>
            <span className={styles.displayName}>
              {post.author.displayName}
            </span>
            <span className={styles.meta}>
              @{post.author.username} · {timeAgo}
              {isEdited && " · edited"}
            </span>
          </div>
        </Link>

        {post.visibility !== "public" && (
          <span
            className={styles.visibilityBadge}
            title={`Visibility: ${post.visibility}`}
          >
            {post.visibility === "followers"
              ? "Followers"
              : post.visibility === "circles"
                ? "Circle"
                : post.visibility === "direct"
                  ? "Direct"
                  : ""}
          </span>
        )}
      </header>

      <div
        className={styles.content}
        dangerouslySetInnerHTML={{ __html: renderContent(post.content) }}
      />

      {post.media && post.media.length > 0 && (
        <div
          className={`${styles.mediaGrid} ${post.media.length === 1 ? styles.mediaSingle : post.media.length === 2 ? styles.mediaTwo : styles.mediaMulti}`}
          role="group"
          aria-label={`${post.media.length} media attachment${post.media.length > 1 ? "s" : ""}`}
        >
          {post.media.map((m) => (
            m.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={m.url}
                alt={m.altText || "Attached image"}
                className={styles.mediaImage}
                loading="lazy"
                width={m.width ?? undefined}
                height={m.height ?? undefined}
              />
            ) : m.type === "video" ? (
              <video
                key={m.id}
                src={m.url}
                controls
                className={styles.mediaVideo}
                aria-label={m.altText || "Attached video"}
              />
            ) : m.type === "audio" ? (
              <audio
                key={m.id}
                src={m.url}
                controls
                className={styles.mediaAudio}
                aria-label={m.altText || "Attached audio"}
              />
            ) : null
          ))}
        </div>
      )}

      <footer className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReaction}
          className={`${styles.actionButton} ${post.userReacted ? styles.reacted : ""}`}
          aria-pressed={post.userReacted}
          aria-label={`+1 (${post.reactionCount})`}
        >
          <span aria-hidden="true">+1</span>
          {post.reactionCount > 0 && (
            <span className={styles.count}>{post.reactionCount}</span>
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onComment}
          className={styles.actionButton}
          aria-label={`Comment (${post.commentCount})`}
        >
          <span aria-hidden="true">Comment</span>
          {post.commentCount > 0 && (
            <span className={styles.count}>{post.commentCount}</span>
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleReshare}
          className={styles.actionButton}
          aria-label={`Reshare (${post.reshareCount})`}
        >
          <span aria-hidden="true">Reshare</span>
          {post.reshareCount > 0 && (
            <span className={styles.count}>{post.reshareCount}</span>
          )}
        </Button>
      </footer>
    </Card>
  );
}

function renderContent(content: string): string {
  let html = escapeHtml(content);

  // Hashtags
  html = html.replace(
    /#(\w+)/g,
    '<a href="/hashtag/$1" class="hashtag">#$1</a>'
  );

  // Mentions
  html = html.replace(
    /@(\w+(?:@[\w.-]+)?)/g,
    '<a href="/$1" class="mention">@$1</a>'
  );

  // Newlines
  html = html.replace(/\n/g, "<br>");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString();
}
