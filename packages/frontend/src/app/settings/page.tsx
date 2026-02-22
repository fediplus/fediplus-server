"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
