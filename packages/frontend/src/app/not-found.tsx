import Link from "next/link";
import styles from "./error.module.css";

export default function NotFound() {
  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Page not found</h2>
      <p className={styles.message}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        style={{ color: "var(--color-primary)", textDecoration: "none" }}
      >
        Go home
      </Link>
    </div>
  );
}
