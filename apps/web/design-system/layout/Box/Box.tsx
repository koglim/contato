import React from "react";
import styles from "./Box.module.css";

export interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  padding?: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "8";
  bg?: "canvas" | "surface" | "subtle" | "elevated" | "muted";
  border?: "none" | "default" | "subtle" | "strong";
  radius?: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "full";
  shadow?: "none" | "xs" | "sm" | "md" | "lg";
  children?: React.ReactNode;
}

export const Box = React.forwardRef<HTMLDivElement, BoxProps>(function Box(
  {
    as: Component = "div",
    padding,
    bg,
    border,
    radius,
    shadow,
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.box,
    padding && styles[`p-${padding}`],
    bg && styles[`bg-${bg}`],
    border && styles[`border-${border}`],
    radius && styles[`radius-${radius}`],
    shadow && styles[`shadow-${shadow}`],
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
