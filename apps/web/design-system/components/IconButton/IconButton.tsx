import React from "react";
import styles from "./IconButton.module.css";
import { Loader2 } from "../../icons";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string; // Accessible name is strictly mandatory
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    "aria-label": ariaLabel,
    variant = "secondary",
    size = "md",
    loading = false,
    disabled = false,
    icon,
    className = "",
    ...props
  },
  ref
) {
  const classes = [
    styles.iconButton,
    styles[`variant-${variant}`],
    styles[`size-${size}`],
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-label={ariaLabel}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      {...props}
    >
      {loading ? (
        <Loader2 className={styles.spinIcon} aria-hidden="true" />
      ) : (
        <span className={styles.iconContainer} aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  );
});
