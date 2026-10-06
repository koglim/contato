import React from "react";
import styles from "./InlineMessage.module.css";
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "../../icons";

export interface InlineMessageProps {
  variant?: "info" | "success" | "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}

export function InlineMessage({
  variant = "info",
  children,
  className = "",
}: InlineMessageProps) {
  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: AlertCircle,
  }[variant];

  return (
    <div
      className={`${styles.message} ${styles[`variant-${variant}`]} ${className}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
    </div>
  );
}
