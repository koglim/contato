import React from "react";
import styles from "./Button.module.css";
import { Loader2 } from "../../icons";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "danger" | "link";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    leftIcon,
    rightIcon,
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.button,
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
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      {...props}
    >
      {loading ? (
        <span className={styles.spinner} aria-hidden="true">
          <Loader2 className={styles.spinIcon} />
        </span>
      ) : leftIcon ? (
        <span className={styles.icon}>{leftIcon}</span>
      ) : null}

      <span className={styles.content}>{children}</span>

      {!loading && rightIcon ? (
        <span className={styles.icon}>{rightIcon}</span>
      ) : null}
    </button>
  );
});
