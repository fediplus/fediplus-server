"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { StreamPost } from "@/stores/feed";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./CommentThread.module.css";

interface CommentThreadProps {
  postId: string;
}

export function CommentThread({ postId }: CommentThreadProps) {
  const [comments, setComments] = useState<StreamPost[]>([]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ items: StreamPost[] }>(`/api/v1/posts/${postId}/comments`)
      .then((data) => setComments(data.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    try {
      const comment = await apiFetch<StreamPost>("/api/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          content,
          visibility: "public",
          replyToId: postId,
        }),
      });

      setComments((prev) => [...prev, comment as unknown as StreamPost]);
      setContent("");
      announce("Comment posted");
    } catch {
      announce("Failed to post comment", "assertive");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.thread} role="region" aria-label="Comments">
      {loading ? (
        <p className={styles.loading} role="status">Loading comments...</p>
      ) : (
        <>
          {comments.map((comment) => (
            <div key={comment.id} className={styles.comment}>
              <div className={styles.commentAvatar} aria-hidden="true">
                {(comment.author?.displayName ?? "?").charAt(0)}
              </div>
              <div className={styles.commentBody}>
                <span className={styles.commentAuthor}>
                  {comment.author?.displayName ?? "Unknown"}
                </span>
                <span className={styles.commentContent}>{comment.content}</span>
              </div>
            </div>
          ))}

          <form onSubmit={handleSubmit} className={styles.replyForm}>
            <input
              type="text"
              className={styles.replyInput}
              placeholder="Write a comment..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              aria-label="Write a comment"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!content.trim() || submitting}
            >
              Reply
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
