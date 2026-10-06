import React from "react";
import styles from "./ErrorState.module.css";
import { AlertCircle } from "../../icons";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Ocorreu um erro",
  description = "Não foi possível carregar as informações. Tente novamente.",
  onRetry,
  retryLabel = "Tentar novamente",
  className = "",
}: ErrorStateProps) {
  return (
    <div className={`${styles.errorState} ${className}`} role="alert">
      <div className={styles.iconContainer}>
        <AlertCircle className={styles.icon} aria-hidden="true" />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={styles.retryButton}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
