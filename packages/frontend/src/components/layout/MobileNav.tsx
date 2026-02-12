"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./MobileNav.module.css";

const MOBILE_NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
  { href: "/compose", label: "Post" },
  { href: "/notifications", label: "Alerts" },
  { href: "/profile", label: "Profile" },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.mobileNav} aria-label="Mobile navigation">
      {MOBILE_NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navItem} ${isActive ? styles.active : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <span className={styles.label}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
