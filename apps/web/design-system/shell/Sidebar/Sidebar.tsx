import React from "react";
import styles from "./Sidebar.module.css";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  badge?: React.ReactNode;
}

export interface SidebarProps {
  brandTitle?: string;
  brandSubtitle?: string;
  items: NavItem[];
  footer?: React.ReactNode;
  collapsed?: boolean;
  className?: string;
}

export function Sidebar({
  brandTitle = "ContatoCerto",
  brandSubtitle = "Painel do Profissional",
  items,
  footer,
  collapsed = false,
  className = "",
}: SidebarProps) {
  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} ${className}`}
      aria-label="Navegação principal"
    >
      <div className={styles.brand}>
        <div className={styles.brandLogo} aria-hidden="true">
          CC
        </div>
        {!collapsed ? (
          <div className={styles.brandText}>
            <span className={styles.brandTitle}>{brandTitle}</span>
            <span className={styles.brandSubtitle}>{brandSubtitle}</span>
          </div>
        ) : null}
      </div>

      <nav className={styles.nav}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className={`${styles.navItem} ${item.active ? styles.navItemActive : ""}`}
            aria-current={item.active ? "page" : undefined}
          >
            <span className={styles.icon}>{item.icon}</span>
            {!collapsed ? <span className={styles.label}>{item.label}</span> : null}
            {!collapsed && item.badge ? (
              <span className={styles.badgeContainer}>{item.badge}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </aside>
  );
}
