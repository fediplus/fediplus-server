"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  // Delete account state
  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksError, setBlocksError] = useState("");
  const [unblocking, setUnblocking] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<BlockedUser[]>("/api/v1/blocks")
      .then(setBlockedUsers)
      .catch(() => setBlocksError("Failed to load blocked users"))
      .finally(() => setBlocksLoading(false));
  }, []);

  async function handleUnblock(userId: string, username: string) {
    setUnblocking(userId);
    try {
      await apiFetch(`/api/v1/users/${userId}/unblock`, { method: "POST" });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
      announce(`Unblocked ${username}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to unblock user";
      setBlocksError(message);
      announce(message, "assertive");
    } finally {
      setUnblocking(null);
    }
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/v1/account/delete", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      logout();
      announce("Account deleted");
      router.push("/login");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong";
      setError(message);
      announce(message, "assertive");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section} aria-labelledby="blocked-heading">
        <Card>
          <div className={styles.blockedSection}>
            <h2 id="blocked-heading" className={styles.sectionTitle}>
              Blocked users
            </h2>
            <p className={styles.sectionDescription}>
              Blocked users can&apos;t see your posts, react, reshare, or
              message you.
            </p>

            {blocksError && (
              <p className={styles.error} role="alert">
                {blocksError}
              </p>
            )}

            {blocksLoading ? (
              <p className={styles.emptyText} role="status">
                Loading…
              </p>
            ) : blockedUsers.length === 0 ? (
              <p className={styles.emptyText}>No blocked users.</p>
            ) : (
              <ul className={styles.blockedList} role="list">
                {blockedUsers.map((user) => (
                  <li key={user.id} className={styles.blockedItem}>
                    <div className={styles.blockedUser}>
                      <div
                        className={styles.blockedAvatar}
                        role="img"
                        aria-label={`${user.displayName ?? user.username}'s avatar`}
                      >
                        {(user.displayName ?? user.username).charAt(0)}
                      </div>
                      <div className={styles.blockedInfo}>
                        <span className={styles.blockedName}>
                          {user.displayName ?? user.username}
                        </span>
                        <span className={styles.blockedUsername}>
                          @{user.username}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unblocking === user.id}
                      onClick={() => handleUnblock(user.id, user.username)}
                      aria-label={`Unblock ${user.username}`}
                    >
                      {unblocking === user.id ? "Unblocking…" : "Unblock"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <Card>
          <div className={styles.dangerZone}>
            <h2 className={styles.dangerTitle}>Delete account</h2>
            <p className={styles.dangerDescription}>
              Permanently delete your account and all associated data. This
              action cannot be undone.
            </p>

            {!showConfirm ? (
              <Button
                type="button"
                className={styles.dangerButton}
                onClick={() => setShowConfirm(true)}
              >
                Delete my account
              </Button>
            ) : (
              <form onSubmit={handleDelete} className={styles.confirmForm}>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}

                <p className={styles.confirmWarning}>
                  Enter your password to confirm account deletion.
                </p>

                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />

                <div className={styles.buttonRow}>
                  <button
                    type="submit"
                    className={styles.dangerButton}
                    disabled={loading}
                  >
                    {loading ? "Deleting..." : "Confirm deletion"}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setShowConfirm(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
