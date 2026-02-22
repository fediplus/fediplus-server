"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import type { EventItem } from "@/stores/events";
import styles from "./page.module.css";

interface RsvpUser {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
}

interface RsvpGroups {
  going: RsvpUser[];
  maybe: RsvpUser[];
  not_going: RsvpUser[];
}

interface EventPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  altText: string;
}

const API_URL = "";

export default function EventDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const user = useAuthStore((s) => s.user);

  const [event, setEvent] = useState<EventItem | null>(null);
  const [rsvps, setRsvps] = useState<RsvpGroups | null>(null);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [myRsvp, setMyRsvp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const loadEvent = useCallback(async () => {
    try {
      const [eventData, rsvpData, photoData] = await Promise.all([
        apiFetch<EventItem>(`/api/v1/events/${id}`),
        apiFetch<RsvpGroups>(`/api/v1/events/${id}/rsvps`),
        apiFetch<{ items: EventPhoto[] }>(`/api/v1/events/${id}/photos`),
      ]);
      setEvent(eventData);
      setRsvps(rsvpData);
      setPhotos(photoData.items);

      // Find current user's RSVP
      if (user) {
        for (const [status, users] of Object.entries(rsvpData)) {
          const found = (users as RsvpUser[]).find((u) => u.userId === user.id);
          if (found) {
            setMyRsvp(status);
            break;
          }
        }
      }
    } catch {
      // Event not found or error
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  async function handleRsvp(status: "going" | "maybe" | "not_going") {
    try {
      await apiFetch(`/api/v1/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setMyRsvp(status);
      const statusLabel = status.replace("_", " ");
      announce(`RSVP updated to ${statusLabel}`);
      // Refresh RSVPs
      const rsvpData = await apiFetch<RsvpGroups>(`/api/v1/events/${id}/rsvps`);
      setRsvps(rsvpData);
    } catch {
      announce("Failed to update RSVP");
    }
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  }

  if (loading) {
    return <p role="status">Loading event...</p>;
  }

  if (!event) {
    return <p>Event not found.</p>;
  }

  const isCreator = user?.id === event.createdById;

  return (
    <div className={styles.container}>
      <Link href="/events" className={styles.backLink}>
        &larr; Back to events
      </Link>

      <Card className={styles.eventHeader}>
        {event.coverUrl && (
          <img
            src={event.coverUrl}
            alt=""
            className={styles.coverImage}
          />
        )}
        <h1 className={styles.eventName}>{event.name}</h1>
        <div className={styles.eventDetails}>
          <span>
            {new Date(event.startDate).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {event.endDate && (
            <span>
              Until{" "}
              {new Date(event.endDate).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
          {event.location && <span>{event.location}</span>}
        </div>
        {event.creator && (
          <div className={styles.creator}>
            <span className={styles.creatorAvatar} aria-hidden="true">
              {event.creator.displayName?.charAt(0) ||
                event.creator.username.charAt(0)}
            </span>
            <span>
              Hosted by{" "}
              {event.creator.displayName || event.creator.username}
            </span>
          </div>
        )}
        {event.description && (
          <p className={styles.description}>{event.description}</p>
        )}
      </Card>

      {/* RSVP */}
      {user && (
        <Card className={styles.rsvpSection}>
          <h2 className={styles.sectionTitle}>Are you going?</h2>
          <div className={styles.rsvpButtons} role="group" aria-label="RSVP options">
            {(["going", "maybe", "not_going"] as const).map((status) => (
              <button
                key={status}
                className={`${styles.rsvpBtn} ${myRsvp === status ? styles.rsvpBtnActive : ""}`}
                onClick={() => handleRsvp(status)}
                aria-pressed={myRsvp === status}
              >
                {status === "going"
                  ? "Going"
                  : status === "maybe"
                    ? "Maybe"
                    : "Not Going"}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Attendees */}
      {rsvps && (
        <Card className={styles.attendeesSection}>
          <h2 className={styles.sectionTitle}>Attendees</h2>
          {(["going", "maybe", "not_going"] as const).map((status) => {
            const group = rsvps[status];
            if (group.length === 0) return null;
            const label =
              status === "going"
                ? "Going"
                : status === "maybe"
                  ? "Maybe"
                  : "Not Going";
            const collapsed = collapsedGroups[status] ?? false;
            return (
              <div key={status} className={styles.statusGroup}>
                <button
                  className={styles.statusLabel}
                  onClick={() => toggleGroup(status)}
                  aria-expanded={!collapsed}
                >
                  {label} ({group.length}) {collapsed ? "+" : "-"}
                </button>
                {!collapsed && (
                  <div className={styles.attendeeList}>
                    {group.map((user) => (
                      <div key={user.id} className={styles.attendee}>
                        <span
                          className={styles.attendeeAvatar}
                          aria-hidden="true"
                        >
                          {user.displayName?.charAt(0) ||
                            user.username.charAt(0)}
                        </span>
                        <span>{user.displayName || user.username}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <a
          href={`${API_URL}/api/v1/events/${id}/ical`}
          className={styles.icalLink}
          download
        >
          Download iCal (.ics)
        </a>
        {isCreator && (
          <Button
            size="sm"
            onClick={async () => {
              // Simple invite dialog — in production would open circle picker
              announce("Invite feature — select circles to invite");
            }}
          >
            Invite circles
          </Button>
        )}
      </div>

      {/* Party Mode photos */}
      {event.partyMode && (
        <Card className={styles.photosSection}>
          <h2 className={styles.sectionTitle}>Party photos</h2>
          {photos.length === 0 ? (
            <p>No photos yet. Be the first to share!</p>
          ) : (
            <div className={styles.photoGrid}>
              {photos.map((photo) => (
                <img
                  key={photo.id}
                  src={photo.thumbnailUrl || photo.url}
                  alt={photo.altText || "Event photo"}
                  className={styles.photo}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
