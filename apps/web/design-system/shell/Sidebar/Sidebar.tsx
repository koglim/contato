"use client";

import React from "react";
import Link from "next/link";
import styles from "./Sidebar.module.css";
import { Tooltip } from "../../components/Tooltip";

type NavItemBase = {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: React.ReactNode;
};

export type NavItemWithHref = NavItemBase & {
  href: string;
  onClick?: () => void;
};

export type NavItemWithAction = NavItemBase & {
  href?: never;
  onClick?: () => void;
};

export type NavItem = NavItemWithHref | NavItemWithAction;

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
        {items.map((item) => {
          const itemClasses = `${styles.navItem} ${item.active ? styles.navItemActive : ""} ${collapsed ? styles.navItemCollapsed : ""}`;

          const itemContent = (
            <>
              <span className={styles.icon}>{item.icon}</span>
              {!collapsed ? <span className={styles.label}>{item.label}</span> : null}
              {!collapsed && item.badge ? (
                <span className={styles.badgeContainer}>{item.badge}</span>
              ) : null}
            </>
          );

          const element = item.href ? (
            <Link
              key={item.id}
              href={item.href}
              onClick={item.onClick}
              className={itemClasses}
              aria-current={item.active ? "page" : undefined}
            >
              {itemContent}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className={itemClasses}
              aria-current={item.active ? "page" : undefined}
            >
              {itemContent}
            </button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.id} content={item.label} side="right">
                {element}
              </Tooltip>
            );
          }

          return element;
        })}
      </nav>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </aside>
  );
}
