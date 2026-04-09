"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./error.module.css";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className={styles.container} role="alert">
      <h2 className={styles.heading}>Something went wrong</h2>
      <p className={styles.message}>
        An error occurred while loading this page.
      </p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
