import React from "react";
import styles from "./Skeleton.module.css";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  radius?: "0" | "1" | "2" | "3" | "4" | "5" | "full";
  circle?: boolean;
}

export function Skeleton({
  width,
  height,
  radius = "3",
  circle = false,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  const inlineStyles: React.CSSProperties = {
    ...style,
    width: circle ? height || width : width,
    height: circle ? width || height : height,
  };

  return (
    <div
      className={`${styles.skeleton} ${circle ? styles.circle : styles[`radius-${radius}`]} ${className}`}
      style={inlineStyles}
      aria-hidden="true"
      {...props}
    />
  );
}
