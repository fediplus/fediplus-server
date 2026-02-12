"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import styles from "./Shell.module.css";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Sidebar />

      <main id="main-content" className={styles.main} tabIndex={-1}>
        {children}
      </main>

      <MobileNav />
    </>
  );
}
