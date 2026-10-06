import React from "react";
import styles from "./PageShell.module.css";
import { Container } from "../../layout";

export interface PageShellProps {
  width?: "narrow" | "standard" | "wide" | "full";
  className?: string;
  children: React.ReactNode;
}

export function PageShell({
  width = "standard",
  className = "",
  children,
}: PageShellProps) {
  return (
    <main id="main-content" className={`${styles.main} ${className}`}>
      <Container width={width} padding>
        {children}
      </Container>
    </main>
  );
}
