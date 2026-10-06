"use client";

import React from "react";
import Link from "next/link";
import styles from "./MobileNavigationDrawer.module.css";
import { Sheet } from "../../components/Sheet";
import { NavItem } from "../Sidebar";

export interface MobileNavigationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandTitle?: string;
  brandSubtitle?: string;
  items: NavItem[];
  footer?: React.ReactNode;
}

export function MobileNavigationDrawer({
  open,
  onOpenChange,
  brandTitle = "ContatoCerto",
  brandSubtitle = "Painel do Profissional",
  items,
  footer,
}: MobileNavigationDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title={brandTitle}
      description={brandSubtitle}
    >
      <div className={styles.wrapper}>
        <nav className={styles.nav} aria-label="Navegação móvel">
          {items.map((item) => {
            const itemClasses = `${styles.navItem} ${item.active ? styles.navItemActive : ""}`;

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={itemClasses}
                  aria-current={item.active ? "page" : undefined}
                  onClick={() => {
                    item.onClick?.();
                    onOpenChange(false);
                  }}
                >
                  <span className={styles.icon}>{item.icon}</span>
                  <span className={styles.label}>{item.label}</span>
                  {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
                </Link>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                className={itemClasses}
                aria-current={item.active ? "page" : undefined}
                onClick={() => {
                  item.onClick?.();
                  onOpenChange(false);
                }}
              >
                <span className={styles.icon}>{item.icon}</span>
                <span className={styles.label}>{item.label}</span>
                {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </Sheet>
  );
}
