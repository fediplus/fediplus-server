"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/hooks/useApi";
import { useFeedStore, type StreamPost } from "@/stores/feed";
import { useAuthStore } from "@/stores/auth";
import { announce } from "@/a11y/announcer";
import { MAX_POST_LENGTH } from "@fediplus/shared";
import styles from "./PostComposer.module.css";

interface Circle {
  id: string;
  name: string;
  color: string;
}

type Visibility = "public" | "circles" | "followers" | "direct";

const VISIBILITY_OPTIONS: { value: Visibility; label: string; description: string }[] = [
  { value: "public", label: "Public", description: "Visible to everyone" },
  { value: "circles", label: "Circles", description: "Only people in selected circles" },
  { value: "followers", label: "Followers", description: "Only your followers" },
  { value: "direct", label: "Direct", description: "Only mentioned people" },
];

export function PostComposer() {
  const user = useAuthStore((s) => s.user);
  const prependPost = useFeedStore((s) => s.prependPost);

  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [selectedCircles, setSelectedCircles] = useState<string[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (user) {
      apiFetch<Circle[]>("/api/v1/circles")
        .then(setCircles)
        .catch(() => {});
    }
  }, [user]);

  if (!user) return null;

  const charCount = content.length;
  const isOverLimit = charCount > MAX_POST_LENGTH;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || isOverLimit || submitting || !user) return;

    setSubmitting(true);
    const currentUser = user;
    try {
      const post = await apiFetch<StreamPost>("/api/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          content,
          visibility,
          circleIds:
            visibility === "circles" ? selectedCircles : undefined,
        }),
      });

      // Enrich with author info for local display
      const enriched: StreamPost = {
        ...post,
        author: {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.username,
          avatarUrl: null,
          actorUri: currentUser.actorUri,
        },
        reactionCount: 0,
        commentCount: 0,
        reshareCount: 0,
        userReacted: false,
        hashtags: post.hashtags ?? [],
        mentions: post.mentions ?? [],
        editHistory: [],
        replyToId: null,
        reshareOfId: null,
        sensitive: false,
        spoilerText: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      prependPost(enriched);
      setContent("");
      setSelectedCircles([]);
      setShowAudiencePicker(false);
      announce("Post created successfully");
    } catch {
      announce("Failed to create post", "assertive");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleCircle(circleId: string) {
    setSelectedCircles((prev) =>
      prev.includes(circleId)
        ? prev.filter((id) => id !== circleId)
        : [...prev, circleId]
    );
  }

  return (
    <Card as="section" className={styles.composer} aria-label="Create a post">
      <form onSubmit={handleSubmit}>
        <div className={styles.inputArea}>
          <div className={styles.avatar} aria-hidden="true">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="What's on your mind?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            aria-label="Post content"
            maxLength={MAX_POST_LENGTH + 100}
          />
        </div>

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAudiencePicker(!showAudiencePicker)}
              aria-expanded={showAudiencePicker}
              aria-controls="audience-picker"
            >
              {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.label}
            </Button>

            <span
              className={`${styles.charCount} ${isOverLimit ? styles.overLimit : ""}`}
              aria-label={`${charCount} of ${MAX_POST_LENGTH} characters used`}
            >
              {charCount > 0 && `${charCount}/${MAX_POST_LENGTH}`}
            </span>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!content.trim() || isOverLimit || submitting}
          >
            {submitting ? "Posting..." : "Post"}
          </Button>
        </div>

        {showAudiencePicker && (
          <div id="audience-picker" className={styles.audiencePicker} role="group" aria-label="Audience selection">
            <fieldset className={styles.visibilityFieldset}>
              <legend className="sr-only">Post visibility</legend>
              {VISIBILITY_OPTIONS.map((opt) => (
                <label key={opt.value} className={styles.visibilityOption}>
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={visibility === opt.value}
                    onChange={() => setVisibility(opt.value)}
                    className="sr-only"
                  />
                  <span
                    className={`${styles.visibilityChip} ${visibility === opt.value ? styles.selected : ""}`}
                  >
                    {opt.label}
                  </span>
                  <span className={styles.visibilityDescription}>
                    {opt.description}
                  </span>
                </label>
              ))}
            </fieldset>

            {visibility === "circles" && circles.length > 0 && (
              <fieldset className={styles.circleFieldset}>
                <legend className={styles.circleLabel}>Select circles</legend>
                {circles.map((circle) => (
                  <label key={circle.id} className={styles.circleOption}>
                    <input
                      type="checkbox"
                      checked={selectedCircles.includes(circle.id)}
                      onChange={() => toggleCircle(circle.id)}
                    />
                    <span
                      className={styles.circleDot}
                      style={{ backgroundColor: circle.color }}
                      aria-hidden="true"
                    />
                    {circle.name}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
