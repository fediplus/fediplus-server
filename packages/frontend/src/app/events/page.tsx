"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import type { EventItem } from "@/stores/events";
import styles from "./page.module.css";

export default function EventsPage() {
  const user = useAuthStore((s) => s.user);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [myEvents, setMyEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("list");
  const [calendarDate, setCalendarDate] = useState(() => new Date());

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) {
      setViewMode("list");
    }

    Promise.all([
      apiFetch<{ items: EventItem[] }>("/api/v1/events").then((d) =>
        setEvents(d.items)
      ),
      user
        ? apiFetch<EventItem[]>("/api/v1/events/mine").then(setMyEvents)
        : Promise.resolve(),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Events</h1>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.toggleBtn} ${viewMode === "list" ? styles.toggleBtnActive : ""}`}
            onClick={() => setViewMode("list")}
            aria-pressed={viewMode === "list"}
          >
            List
          </button>
          <button
            className={`${styles.toggleBtn} ${viewMode === "calendar" ? styles.toggleBtnActive : ""}`}
            onClick={() => setViewMode("calendar")}
            aria-pressed={viewMode === "calendar"}
          >
            Calendar
          </button>
          {user && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowCreate(!showCreate)}
            >
              Create event
            </Button>
          )}
        </div>
      </header>

      {showCreate && (
        <CreateEventForm
          onCreated={(event) => {
            setMyEvents((prev) => [...prev, event]);
            setShowCreate(false);
            announce("Event created");
          }}
        />
      )}

      {loading ? (
        <p role="status">Loading events...</p>
      ) : (
        <>
          {myEvents.length > 0 && (
            <section>
              <h2 className={styles.sectionTitle}>My events</h2>
              <EventList events={myEvents} />
            </section>
          )}

          <section>
            <h2 className={styles.sectionTitle}>Upcoming events</h2>
            {events.length === 0 ? (
              <p className={styles.empty}>No upcoming events yet.</p>
            ) : viewMode === "calendar" ? (
              <CalendarView
                events={events}
                date={calendarDate}
                onDateChange={setCalendarDate}
              />
            ) : (
              <EventList events={events} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventList({ events }: { events: EventItem[] }) {
  // Group by month
  const grouped = useMemo(() => {
    const groups: Record<string, EventItem[]> = {};
    for (const event of events) {
      const d = new Date(event.startDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
      if (!groups[label]) groups[label] = [];
      groups[label].push(event);
    }
    return Object.entries(groups);
  }, [events]);

  return (
    <div className={styles.eventList} role="list" aria-label="Events">
      {grouped.map(([month, items]) => (
        <div key={month} className={styles.monthGroup}>
          <h3 className={styles.monthGroupTitle}>{month}</h3>
          {items.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className={styles.cardLink}
              role="listitem"
            >
              <Card className={styles.eventCard}>
                <h4 className={styles.eventName}>{event.name}</h4>
                <div className={styles.eventMeta}>
                  <span>{formatDate(event.startDate)}</span>
                  {event.location && <span>{event.location}</span>}
                  {event.rsvpCounts && (
                    <span>{event.rsvpCounts.going} going</span>
                  )}
                  {event.visibility === "private" && (
                    <span className={styles.privateBadge}>Private</span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarView({
  events,
  date,
  onDateChange,
}: {
  events: EventItem[];
  date: Date;
  onDateChange: (d: Date) => void;
}) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDay = useMemo(() => {
    const map: Record<number, EventItem[]> = {};
    for (const event of events) {
      const d = new Date(event.startDate);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(event);
      }
    }
    return map;
  }, [events, year, month]);

  const monthLabel = new Date(year, month).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <div className={styles.calendarHeader}>
        <span className={styles.monthLabel}>{monthLabel}</span>
        <div className={styles.calendarNav}>
          <Button
            size="sm"
            onClick={() => onDateChange(new Date(year, month - 1, 1))}
            aria-label="Previous month"
          >
            &larr;
          </Button>
          <Button
            size="sm"
            onClick={() => onDateChange(new Date(year, month + 1, 1))}
            aria-label="Next month"
          >
            &rarr;
          </Button>
        </div>
      </div>
      <div
        className={styles.calendarGrid}
        role="grid"
        aria-label={`Calendar for ${monthLabel}`}
      >
        {dayNames.map((d) => (
          <div key={d} className={styles.dayHeader} role="columnheader">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className={`${styles.calendarDay} ${styles.calendarDayEmpty}`}
            role="gridcell"
          />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayEvents = eventsByDay[day] ?? [];
          return (
            <div key={day} className={styles.calendarDay} role="gridcell">
              <span className={styles.calendarDayNumber}>{day}</span>
              {dayEvents.length > 0 && (
                <div>
                  {dayEvents.map((e) => (
                    <span
                      key={e.id}
                      className={styles.eventDot}
                      title={e.name}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateEventForm({
  onCreated,
}: {
  onCreated: (event: EventItem) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        name,
        startDate: new Date(startDate).toISOString(),
        visibility,
      };
      if (description) body.description = description;
      if (endDate) body.endDate = new Date(endDate).toISOString();
      if (location) body.location = location;

      const event = await apiFetch<EventItem>("/api/v1/events", {
        method: "POST",
        body: JSON.stringify(body),
      });
      onCreated(event);
      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setLocation("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={styles.createForm}>
      <h2 className={styles.formTitle}>Create an event</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Input
          label="Event name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
        />
        <div className={styles.field}>
          <label htmlFor="event-desc" className={styles.label}>
            Description
          </label>
          <textarea
            id="event-desc"
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={5000}
          />
        </div>
        <div className={styles.dateRow}>
          <Input
            label="Start date & time"
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <Input
            label="End date & time (optional)"
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <Input
          label="Location (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={200}
        />
        <div className={styles.field}>
          <label htmlFor="event-visibility" className={styles.label}>
            Visibility
          </label>
          <select
            id="event-visibility"
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "public" | "private")
            }
            className={styles.textarea}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting || !name || !startDate}>
          {submitting ? "Creating..." : "Create event"}
        </Button>
      </form>
    </Card>
  );
}
