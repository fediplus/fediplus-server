"use client";

import { PostComposer } from "@/components/feed/PostComposer";
import { Stream } from "@/components/feed/Stream";
import { useAuthStore } from "@/stores/auth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import styles from "./page.module.css";

export default function HomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className={styles.container}>
      <h1 className="sr-only">Home</h1>

      {user ? (
        <>
          <PostComposer />
          <Stream />
        </>
      ) : (
        <Card className={styles.welcomeCard} elevation={2}>
          <h2 className={styles.cardTitle}>Welcome to Fedi+</h2>
          <p className={styles.cardText}>
            Google+ reborn on the Fediverse. Share with the right people using
            Circles, join Communities, curate Collections, and connect through
            Hangouts — all powered by ActivityPub.
          </p>
          <div className={styles.actions}>
            <Link href="/register">
              <Button variant="primary">Create account</Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary">Sign in</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
