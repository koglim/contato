import React from "react";
import styles from "./PageShell.module.css";
import { Container } from "../../layout";

export interface PageShellProps {
  as?: "main" | "div";
  width?: "narrow" | "standard" | "wide" | "full";
  className?: string;
  children: React.ReactNode;
}

export function PageShell({
  as: Component = "div",
  width = "standard",
  className = "",
  children,
}: PageShellProps) {
  return (
    <Component className={`${styles.main} ${className}`}>
      <Container width={width} padding>
        {children}
      </Container>
    </Component>
  );
}
