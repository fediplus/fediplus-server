import { Card } from "@/components/ui/Card";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Home</h1>

      <Card as="article" className={styles.welcomeCard}>
        <h2 className={styles.cardTitle}>Welcome to Fedi+</h2>
        <p className={styles.cardText}>
          Google+ reborn on the Fediverse. Share with the right people using
          Circles, join Communities, curate Collections, and connect through
          Hangouts — all powered by ActivityPub.
        </p>
      </Card>

      <section aria-label="Timeline">
        <h2 className="sr-only">Your timeline</h2>
        <p className={styles.emptyState}>
          Your timeline is empty. Follow people or join communities to see posts
          here.
        </p>
      </section>
    </div>
  );
}
