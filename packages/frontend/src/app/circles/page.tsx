"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface Circle {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  memberCount: number;
}

export default function CirclesPage() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [viewMode, setViewMode] = useState<"visual" | "list">("visual");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Detect if user might benefit from list mode
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) {
      setViewMode("list");
    }

    loadCircles();
  }, []);

  async function loadCircles() {
    try {
      const data = await apiFetch<Circle[]>("/api/v1/circles");
      setCircles(data);
    } catch {
      // Not logged in or error
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Circles</h1>

        <div className={styles.controls}>
          <fieldset className={styles.viewToggle}>
            <legend className="sr-only">View mode</legend>
            <Button
              variant={viewMode === "visual" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setViewMode("visual")}
              aria-pressed={viewMode === "visual"}
            >
              Visual
            </Button>
            <Button
              variant={viewMode === "list" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
            >
              List
            </Button>
          </fieldset>
        </div>
      </header>

      {loading ? (
        <p className={styles.loading} role="status">
          Loading circles...
        </p>
      ) : circles.length === 0 ? (
        <Card>
          <p className={styles.emptyState}>
            No circles yet. Sign in to see your default circles or create new
            ones.
          </p>
        </Card>
      ) : viewMode === "visual" ? (
        <CirclesVisualView circles={circles} />
      ) : (
        <CirclesListView circles={circles} />
      )}
    </div>
  );
}

function CirclesVisualView({ circles }: { circles: Circle[] }) {
  return (
    <div className={styles.visualGrid} role="list" aria-label="Your circles">
      {circles.map((circle) => (
        <Card
          key={circle.id}
          className={styles.circleCard}
          role="listitem"
          style={{ borderTopColor: circle.color }}
        >
          <div
            className={styles.circleIndicator}
            style={{ backgroundColor: circle.color }}
            aria-hidden="true"
          />
          <h2 className={styles.circleName}>{circle.name}</h2>
          <p className={styles.circleMeta}>
            {circle.memberCount}{" "}
            {circle.memberCount === 1 ? "person" : "people"}
          </p>
          {circle.isDefault && (
            <span className={styles.defaultBadge}>Default</span>
          )}
        </Card>
      ))}
    </div>
  );
}

function CirclesListView({ circles }: { circles: Circle[] }) {
  return (
    <ul className={styles.listView} aria-label="Your circles">
      {circles.map((circle) => (
        <li key={circle.id} className={styles.listItem}>
          <Card className={styles.listCard}>
            <span
              className={styles.listColor}
              style={{ backgroundColor: circle.color }}
              aria-hidden="true"
            />
            <div className={styles.listInfo}>
              <span className={styles.listName}>{circle.name}</span>
              <span className={styles.listMeta}>
                {circle.memberCount}{" "}
                {circle.memberCount === 1 ? "person" : "people"}
                {circle.isDefault ? " — Default" : ""}
              </span>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
