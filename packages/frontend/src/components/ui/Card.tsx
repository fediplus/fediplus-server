"use client";

import type { HTMLAttributes } from "react";
import styles from "./Card.module.css";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  as?: "div" | "article" | "section";
  elevation?: 1 | 2 | 3;
}

export function Card({
  as: Component = "div",
  elevation = 1,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Component
      className={`${styles.card} ${styles[`elevation${elevation}`]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </Component>
  );
}
