import React from "react";
import styles from "./ErrorState.module.css";
import { AlertCircle } from "../../icons";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

export function ErrorState({
  title = "Ocorreu um erro",
  description = "Não foi possível carregar as informações. Tente novamente.",
  onRetry,
  retryLabel = "Tentar novamente",
  headingLevel = 3,
  className = "",
}: ErrorStateProps) {
  const HeadingTag = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={`${styles.errorState} ${className}`} role="alert">
      <div className={styles.iconContainer}>
        <AlertCircle className={styles.icon} aria-hidden="true" />
      </div>
      <HeadingTag className={styles.title}>{title}</HeadingTag>
      <p className={styles.description}>{description}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={styles.retryButton}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
