"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface HangoutItem {
  id: string;
  name: string | null;
  visibility: "public" | "private";
  status: "waiting" | "active" | "ended";
  createdById: string;
  maxParticipants: number;
  rtmpActive: boolean;
  createdAt: string;
}

export default function HangoutsPage() {
  const user = useAuthStore((s) => s.user);
  const [hangouts, setHangouts] = useState<HangoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    apiFetch<{ items: HangoutItem[] }>("/api/v1/hangouts")
      .then((d) => setHangouts(d.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Hangouts</h1>
        <div className={styles.actions}>
          {user && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
            >
              Start Hangout
            </Button>
          )}
        </div>
      </header>

      {showCreate && (
        <CreateHangoutForm
          onCreated={(hangout) => {
            setHangouts((prev) => [hangout, ...prev]);
            setShowCreate(false);
            announce("Hangout created");
          }}
        />
      )}

      {loading ? (
        <p role="status">Loading hangouts...</p>
      ) : hangouts.length === 0 ? (
        <p className={styles.empty}>No active hangouts. Start one!</p>
      ) : (
        <section>
          <h2 className={styles.sectionTitle}>Active Hangouts</h2>
          <div className={styles.hangoutGrid} role="list" aria-label="Hangouts">
            {hangouts.map((hangout) => (
              <Link
                key={hangout.id}
                href={`/hangouts/${hangout.id}`}
                className={styles.cardLink}
                role="listitem"
              >
                <Card className={styles.hangoutCard}>
                  <h3 className={styles.hangoutName}>
                    {hangout.name || "Unnamed Hangout"}
                  </h3>
                  <div className={styles.hangoutMeta}>
                    <span
                      className={`${styles.statusBadge} ${
                        hangout.status === "active"
                          ? styles.statusActive
                          : styles.statusWaiting
                      }`}
                    >
                      {hangout.status === "active" ? "Active" : "Waiting"}
                    </span>
                    {hangout.rtmpActive && (
                      <span className={styles.liveBadge}>LIVE</span>
                    )}
                    <span>Max {hangout.maxParticipants} participants</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CreateHangoutForm({
  onCreated,
}: {
  onCreated: (hangout: HangoutItem) => void;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, unknown> = { visibility };
      if (name.trim()) body.name = name.trim();

      const hangout = await apiFetch<HangoutItem>("/api/v1/hangouts", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(hangout);
      setName("");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create hangout"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={styles.createForm}>
      <h2 className={styles.formTitle}>Start a Hangout</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Input
          label="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="My Hangout"
        />
        <div className={styles.field}>
          <label htmlFor="hangout-visibility" className={styles.label}>
            Visibility
          </label>
          <select
            id="hangout-visibility"
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "public" | "private")
            }
            className={styles.select}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Start Hangout"}
        </Button>
      </form>
    </Card>
  );
}
