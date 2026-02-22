"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "../login/page.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
      announce("If an account exists, a reset link has been sent");
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
      <Card className={styles.card} elevation={2}>
        <h1 className={styles.title}>Reset Password</h1>

        {sent ? (
          <>
            <p className={styles.footer}>
              If an account exists with that email, we&apos;ve sent a password
              reset link. Check your inbox.
            </p>
            <p className={styles.footer}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit} className={styles.form}>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}

              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />

              <Button type="submit" disabled={loading}>
                {loading ? "Sending..." : "Send reset link"}
              </Button>
            </form>

            <p className={styles.footer}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
