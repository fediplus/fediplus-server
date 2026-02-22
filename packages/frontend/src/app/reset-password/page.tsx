"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "../login/page.module.css";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      announce("Passwords do not match", "assertive");
      return;
    }

    setLoading(true);

    try {
      await apiFetch<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      announce("Password reset successfully");
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

  if (!token) {
    return (
      <div className={styles.container}>
        <Card className={styles.card} elevation={2}>
          <h1 className={styles.title}>Invalid Link</h1>
          <p className={styles.footer}>
            This password reset link is invalid. Please{" "}
            <Link href="/forgot-password">request a new one</Link>.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Card className={styles.card} elevation={2}>
        <h1 className={styles.title}>Set New Password</h1>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Input
            label="New Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />

          <Input
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />

          <Button type="submit" disabled={loading}>
            {loading ? "Resetting..." : "Reset password"}
          </Button>
        </form>

        <p className={styles.footer}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </Card>
    </div>
  );
}
