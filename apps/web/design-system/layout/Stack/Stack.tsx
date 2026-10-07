import React from "react";
import styles from "./Stack.module.css";

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  gap?: "1" | "2" | "3" | "4" | "5" | "6" | "8" | "10" | "12";
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  children?: React.ReactNode;
}

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(function Stack(
  {
    as: Component = "div",
    gap = "4",
    align = "stretch",
    justify = "start",
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.stack,
    styles[`gap-${gap}`],
    styles[`align-${align}`],
    styles[`justify-${justify}`],
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
