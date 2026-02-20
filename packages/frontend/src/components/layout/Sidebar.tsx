"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "home", enabled: true },
  { href: "/profile", label: "Profile", icon: "person", enabled: true },
  { href: "/circles", label: "Circles", icon: "circles", enabled: true },
  { href: "/communities", label: "Communities", icon: "group", enabled: true },
  { href: "/collections", label: "Collections", icon: "collection", enabled: true },
  { href: "/photos", label: "Photos", icon: "photo", enabled: true },
  { href: "/events", label: "Events", icon: "event", enabled: true },
  { href: "/hangouts", label: "Hangouts", icon: "videocam", enabled: false },
  { href: "/messages", label: "Messages", icon: "chat", enabled: true },
] as const;

const ICON_MAP: Record<string, string> = {
  home: "\u2302",
  person: "\u263A",
  circles: "\u25CB",
  group: "\u2615",
  collection: "\u2630",
  photo: "\u25A3",
  event: "\u2637",
  videocam: "\u25B6",
  chat: "\u2709",
};

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      <div className={styles.logo}>
        <Link href="/" className={styles.logoLink}>
          <span className={styles.logoText}>Fedi+</span>
        </Link>
      </div>

      <ul className={styles.navList} role="list">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          if (!item.enabled) {
            return (
              <li key={item.href}>
                <span
                  className={`${styles.navItem} ${styles.disabled}`}
                  aria-disabled="true"
                  title="Coming soon"
                >
                  <span className={styles.icon} aria-hidden="true">
                    {ICON_MAP[item.icon]}
                  </span>
                  <span className={styles.navLabel}>{item.label}</span>
                  <span className={styles.comingSoon}>Soon</span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.navItem} ${isActive ? styles.active : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className={styles.icon} aria-hidden="true">
                  {ICON_MAP[item.icon]}
                </span>
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
