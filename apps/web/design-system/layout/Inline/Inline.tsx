import React from "react";
import styles from "./Inline.module.css";

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
  gap?: "1" | "2" | "3" | "4" | "5" | "6" | "8";
  align?: "start" | "center" | "end" | "baseline";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  children?: React.ReactNode;
}

export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(function Inline(
  {
    as: Component = "div",
    gap = "3",
    align = "center",
    justify = "start",
    wrap = true,
    className = "",
    children,
    ...props
  },
  ref
) {
  const classes = [
    styles.inline,
    styles[`gap-${gap}`],
    styles[`align-${align}`],
    styles[`justify-${justify}`],
    wrap ? styles.wrap : styles.nowrap,
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
