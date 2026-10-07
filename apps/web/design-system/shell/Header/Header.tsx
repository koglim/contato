import React from "react";
import styles from "./Header.module.css";
import { Menu } from "../../icons";
import { IconButton } from "../../components";

export interface HeaderProps {
  onMenuToggle?: () => void;
  actions?: React.ReactNode;
  title?: string;
  className?: string;
}

export function Header({
  onMenuToggle,
  actions,
  title,
  className = "",
}: HeaderProps) {
  return (
    <header className={`${styles.header} ${className}`}>
      <div className={styles.left}>
        {onMenuToggle ? (
          <div className={styles.menuTrigger}>
            <IconButton
              icon={<Menu />}
              aria-label="Abrir menu de navegação"
              variant="tertiary"
              onClick={onMenuToggle}
            />
          </div>
        ) : null}

        {title ? <span className={styles.title}>{title}</span> : null}
      </div>

      <div className={styles.right}>{actions}</div>
    </header>
  );
}
