import React from "react";
import styles from "./Grid.module.css";

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  columns?: "1" | "2" | "3" | "4" | "6" | "12" | "auto-fit";
  gap?: "2" | "3" | "4" | "5" | "6" | "8";
  children?: React.ReactNode;
}

export const Grid = React.forwardRef<HTMLDivElement, GridProps>(function Grid(
  {
    as: Component = "div",
    columns = "1",
    gap = "4",
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.grid,
    styles[`cols-${columns}`],
    styles[`gap-${gap}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component ref={ref} className={classes} {...props}>
      {children}
    </Component>
  );
});
