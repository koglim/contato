import React from "react";
import styles from "./Card.module.css";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "interactive" | "selected" | "muted" | "danger" | "warning";
  padding?: "dense" | "default" | "intermediate";
  children?: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "default",
    padding = "default",
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.card,
    styles[`variant-${variant}`],
    styles[`padding-${padding}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className={classes} {...props}>
      {children}
    </div>
  );
});
