import React from "react";
import styles from "./Container.module.css";

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  width?: "narrow" | "standard" | "wide" | "full";
  padding?: boolean;
  children?: React.ReactNode;
}

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(function Container(
  {
    as: Component = "div",
    width = "standard",
    padding = true,
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.container,
    styles[`width-${width}`],
    padding && styles.padded,
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
