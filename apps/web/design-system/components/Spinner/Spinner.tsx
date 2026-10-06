import React from "react";
import styles from "./Spinner.module.css";
import { Loader2 } from "../../icons";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

export function Spinner({
  size = "md",
  label = "Carregando...",
  className = "",
}: SpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${styles[`size-${size}`]} ${className}`}
      role="status"
      aria-label={label}
    >
      <Loader2 className={styles.icon} aria-hidden="true" />
      <span className="cc-sr-only">{label}</span>
    </span>
  );
}
