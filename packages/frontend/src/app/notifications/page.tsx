"use client";

import { useEffect, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  useNotificationStore,
  type NotificationItem,
} from "@/stores/notifications";
import { useSSE } from "@/hooks/useSSE";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

const NOTIFICATION_TEXT: Record<string, (actor: string) => string> = {
  follow: (actor) => `${actor} followed you`,
  follow_accepted: (actor) => `${actor} accepted your follow request`,
  reaction: (actor) => `${actor} +1'd your post`,
  comment: (actor) => `${actor} commented on your post`,
  mention: (actor) => `${actor} mentioned you`,
  reshare: (actor) => `${actor} reshared your post`,
};

export default function NotificationsPage() {
  const { items, cursor, setItems, appendItems, prependItem, clearUnread } =
    useNotificationStore();

  useEffect(() => {
    apiFetch<{ items: NotificationItem[]; cursor: string | null }>(
      "/api/v1/notifications"
    )
      .then((data) => setItems(data.items, data.cursor))
      .catch(() => {});

    // Mark all as read when visiting the page
    apiFetch("/api/v1/notifications/read-all", { method: "POST" }).catch(
      () => {}
    );
    clearUnread();
  }, [setItems, clearUnread]);

  // Live notifications
  useSSE(
    useCallback(
      (event: string, data: unknown) => {
        if (event === "notification") {
          prependItem(data as NotificationItem);
          const n = data as NotificationItem;
          const text = NOTIFICATION_TEXT[n.type]?.(n.actor.displayName);
          if (text) announce(text);
        }
      },
      [prependItem]
    )
  );

  async function loadMore() {
    if (!cursor) return;
    try {
      const data = await apiFetch<{
        items: NotificationItem[];
        cursor: string | null;
      }>(`/api/v1/notifications?cursor=${cursor}`);
      appendItems(data.items, data.cursor);
    } catch {
      // Ignore
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Notifications</h1>

      {items.length === 0 ? (
        <p className={styles.empty}>No notifications yet.</p>
      ) : (
        <ul className={styles.list} role="list" aria-label="Notifications">
          {items.map((item) => (
            <li key={item.id}>
              <Card
                className={`${styles.notificationCard} ${!item.read ? styles.unread : ""}`}
              >
                <div className={styles.avatar} aria-hidden="true">
                  {item.actor.displayName.charAt(0)}
                </div>
                <div className={styles.content}>
                  <p className={styles.text}>
                    {NOTIFICATION_TEXT[item.type]?.(item.actor.displayName) ??
                      `${item.actor.displayName} interacted with you`}
                  </p>
                  <time
                    className={styles.time}
                    dateTime={item.createdAt}
                  >
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className={styles.loadMore}>
          <Button variant="secondary" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
