import React from "react";
import styles from "./Alert.module.css";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "../../icons";

export interface AlertProps {
  variant?: "info" | "success" | "warning" | "danger";
  title?: string;
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function Alert({
  variant = "info",
  title,
  onClose,
  className = "",
  children,
}: AlertProps) {
  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: AlertCircle,
  }[variant];

  return (
    <div
      className={`${styles.alert} ${styles[`variant-${variant}`]} ${className}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      <div className={styles.iconContainer}>
        <Icon className={styles.icon} aria-hidden="true" />
      </div>

      <div className={styles.content}>
        {title ? <h4 className={styles.title}>{title}</h4> : null}
        <div className={styles.body}>{children}</div>
      </div>

      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className={styles.closeButton}
          aria-label="Fechar alerta"
        >
          <X className={styles.closeIcon} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
