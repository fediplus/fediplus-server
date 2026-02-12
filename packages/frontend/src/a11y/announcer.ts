"use client";

let announcer: HTMLElement | null = null;

function getAnnouncer(): HTMLElement {
  if (announcer) return announcer;

  announcer = document.createElement("div");
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  announcer.setAttribute("aria-atomic", "true");
  announcer.className = "sr-only";
  document.body.appendChild(announcer);

  return announcer;
}

export function announce(message: string, priority: "polite" | "assertive" = "polite") {
  const el = getAnnouncer();
  el.setAttribute("aria-live", priority);
  // Clear and re-set to trigger screen reader announcement
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}
