"use client";

import React, { useState } from "react";
import styles from "./AppShell.module.css";
import { Sidebar, NavItem } from "../Sidebar";
import { Header } from "../Header";
import { Sheet } from "../../components/Sheet";

export interface AppShellProps {
  navItems: NavItem[];
  headerActions?: React.ReactNode;
  userMenu?: React.ReactNode;
  brandTitle?: string;
  brandSubtitle?: string;
  children: React.ReactNode;
}

export function AppShell({
  navItems,
  headerActions,
  userMenu,
  brandTitle = "ContatoCerto",
  brandSubtitle = "Painel do Profissional",
  children,
}: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div className={styles.appShell}>
      {/* Skip to Content Accessibility Link */}
      <a href="#main-content" className={styles.skipLink}>
        Ir direto para o conteúdo principal
      </a>

      {/* Desktop Sidebar (hidden on mobile/tablet) */}
      <div className={styles.desktopSidebar}>
        <Sidebar
          brandTitle={brandTitle}
          brandSubtitle={brandSubtitle}
          items={navItems}
          footer={userMenu}
        />
      </div>

      {/* Mobile Drawer Navigation (Sheet) */}
      <Sheet
        open={mobileDrawerOpen}
        onOpenChange={setMobileDrawerOpen}
        side="left"
        title={brandTitle}
        description={brandSubtitle}
      >
        <div className={styles.mobileNavWrapper}>
          <nav className={styles.mobileNav}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  item.onClick?.();
                  setMobileDrawerOpen(false);
                }}
                className={`${styles.mobileNavItem} ${item.active ? styles.mobileNavItemActive : ""}`}
                aria-current={item.active ? "page" : undefined}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge ? <span>{item.badge}</span> : null}
              </button>
            ))}
          </nav>
          {userMenu ? <div className={styles.mobileUserMenu}>{userMenu}</div> : null}
        </div>
      </Sheet>

      {/* Main Layout Area */}
      <div className={styles.mainArea}>
        <Header
          onMenuToggle={() => setMobileDrawerOpen(true)}
          actions={headerActions}
        />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
