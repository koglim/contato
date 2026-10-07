import React from "react";
import styles from "./Badge.module.css";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "info" | "success" | "warning" | "danger" | "accent";
  size?: "sm" | "md";
  pill?: boolean;
  children?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    variant = "neutral",
    size = "md",
    pill = false,
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.badge,
    styles[`variant-${variant}`],
    styles[`size-${size}`],
    pill ? styles.pill : styles.rounded,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={ref} className={classes} {...props}>
      {children}
    </span>
  );
});
