import React from "react";
import styles from "./PageSection.module.css";

export interface PageSectionProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PageSection({
  title,
  description,
  actions,
  children,
  className = "",
}: PageSectionProps) {
  return (
    <section className={`${styles.section} ${className}`}>
      {title || actions ? (
        <div className={styles.header}>
          <div>
            {title ? <h2 className={styles.title}>{title}</h2> : null}
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}

      <div className={styles.content}>{children}</div>
    </section>
  );
}
