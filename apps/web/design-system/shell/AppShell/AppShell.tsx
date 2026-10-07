"use client";

import React, { useState } from "react";
import styles from "./AppShell.module.css";
import { Sidebar, NavItem } from "../Sidebar";
import { Header } from "../Header";
import { MobileNavigationDrawer } from "../MobileNavigationDrawer";
import { IconButton } from "../../components/IconButton";
import { ChevronLeft, ChevronRight } from "../../icons";

export interface AppShellProps {
  navItems: NavItem[];
  headerActions?: React.ReactNode;
  userMenu?: React.ReactNode;
  brandTitle?: string;
  brandSubtitle?: string;
  sidebarCollapsed?: boolean;
  defaultSidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  children: React.ReactNode;
}

export function AppShell({
  navItems,
  headerActions,
  userMenu,
  brandTitle = "ContatoCerto",
  brandSubtitle = "Painel do Profissional",
  sidebarCollapsed: controlledSidebarCollapsed,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  children,
}: AppShellProps) {
  const [uncontrolledSidebarCollapsed, setUncontrolledSidebarCollapsed] = useState(defaultSidebarCollapsed);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const isControlled = controlledSidebarCollapsed !== undefined;
  const isCollapsed = isControlled ? controlledSidebarCollapsed : uncontrolledSidebarCollapsed;

  const handleToggleCollapse = () => {
    const next = !isCollapsed;
    if (!isControlled) {
      setUncontrolledSidebarCollapsed(next);
    }
    onSidebarCollapsedChange?.(next);
  };

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
          collapsed={isCollapsed}
          footer={
            <div className={styles.sidebarFooter}>
              {userMenu ? <div className={styles.userMenuContainer}>{userMenu}</div> : null}
              <div className={styles.railToggleContainer}>
                <IconButton
                  icon={isCollapsed ? <ChevronRight /> : <ChevronLeft />}
                  aria-label={isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
                  variant="tertiary"
                  size="sm"
                  onClick={handleToggleCollapse}
                />
              </div>
            </div>
          }
        />
      </div>

      {/* Mobile Drawer Navigation */}
      <MobileNavigationDrawer
        open={mobileDrawerOpen}
        onOpenChange={setMobileDrawerOpen}
        brandTitle={brandTitle}
        brandSubtitle={brandSubtitle}
        items={navItems}
        footer={userMenu}
      />

      {/* Main Layout Area */}
      <div className={styles.mainArea}>
        <Header
          onMenuToggle={() => setMobileDrawerOpen(true)}
          actions={headerActions}
        />
        <main id="main-content" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
