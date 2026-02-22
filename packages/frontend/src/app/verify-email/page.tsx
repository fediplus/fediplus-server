"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "../login/page.module.css";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(
    token ? "verifying" : "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  // Resend form state
  const [email, setEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    if (!token) return;

    apiFetch<{ message: string }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus("success");
        announce("Email verified successfully");
      })
      .catch((err) => {
        setStatus("error");
        const msg = err instanceof ApiError ? err.message : "Verification failed";
        setErrorMessage(msg);
        announce(msg, "assertive");
      });
  }, [token]);

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    setResendLoading(true);
    setResendMessage("");

    try {
      const result = await apiFetch<{ message: string }>("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResendMessage(result.message);
      announce(result.message);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong";
      setResendMessage(msg);
      announce(msg, "assertive");
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <Card className={styles.card} elevation={2}>
        {status === "verifying" && (
          <>
            <h1 className={styles.title}>Verifying...</h1>
            <p className={styles.footer}>Please wait while we verify your email.</p>
          </>
        )}

        {status === "success" && (
          <>
            <h1 className={styles.title}>Email Verified</h1>
            <p className={styles.footer}>
              Your email has been verified. You can now{" "}
              <Link href="/login">sign in</Link>.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 className={styles.title}>Verification Failed</h1>
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
            <p className={styles.footer}>
              The link may have expired.{" "}
              Request a new one below.
            </p>
          </>
        )}

        {status === "idle" && (
          <>
            <h1 className={styles.title}>Check Your Email</h1>
            <p className={styles.footer}>
              We sent a verification link to your email address. Click the link
              to activate your account.
            </p>
          </>
        )}

        {(status === "idle" || status === "error") && (
          <form onSubmit={handleResend} className={styles.form}>
            {resendMessage && (
              <p className={styles.footer} role="status">
                {resendMessage}
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

            <Button type="submit" disabled={resendLoading}>
              {resendLoading ? "Sending..." : "Resend verification email"}
            </Button>
          </form>
        )}

        <p className={styles.footer}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </Card>
    </div>
  );
}
