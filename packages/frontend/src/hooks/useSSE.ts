"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth";

type SSEHandler = (event: string, data: unknown) => void;

export function useSSE(onEvent: SSEHandler) {
  const token = useAuthStore((s) => s.token);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!token) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const eventSource = new EventSource(
      `${apiUrl}/api/v1/sse?token=${encodeURIComponent(token)}`
    );

    const events = [
      "new_post",
      "notification",
      "post_updated",
      "post_deleted",
      "reaction",
      "event_rsvp",
      "event_photo",
      "new_message",
      "participant_joined",
      "participant_left",
      "media_state_changed",
      "stream_started",
      "stream_stopped",
      "hangout_ended",
    ];

    for (const event of events) {
      eventSource.addEventListener(event, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          handlerRef.current(event, data);
        } catch {
          // Ignore malformed events
        }
      });
    }

    eventSource.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      eventSource.close();
    };
  }, [token]);
}
