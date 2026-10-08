"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "../../design-system/shell/AppShell";
import { AccountMenu } from "../../design-system/shell/AccountMenu";
import { PageHeader as DSPageHeader } from "../../design-system/shell/PageHeader";
import { Badge } from "../../design-system/components/Badge";
import type { NavItem } from "../../design-system/shell/Sidebar";
import { Home, User, Briefcase, MapPin, Clock, LogOut } from "../../design-system/icons";

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      id: "overview",
      label: "Visão geral",
      icon: <Home size={20} />,
      href: "/dashboard",
      active: pathname === "/dashboard",
    },
    {
      id: "profile",
      label: "Perfil",
      icon: <User size={20} />,
      href: "/dashboard/profile",
      active: pathname === "/dashboard/profile",
    },
    {
      id: "services",
      label: "Serviços",
      icon: <Briefcase size={20} />,
      href: "/dashboard/services",
      active: pathname === "/dashboard/services",
    },
    {
      id: "areas",
      label: "Área de atendimento",
      icon: <MapPin size={20} />,
      href: "/dashboard/service-areas",
      active: pathname === "/dashboard/service-areas",
    },
    {
      id: "availability",
      label: "Disponibilidade",
      icon: <Clock size={20} />,
      href: "/dashboard/availability",
      active: pathname === "/dashboard/availability",
    },
  ];

  const handleLogout = async () => {
    try {
      await fetch("/api/dashboard/logout", { method: "POST" });
    } finally {
      window.location.href = "/dashboard/access";
    }
  };

  const userMenu = (
    <AccountMenu
      name="Profissional"
      email="Painel do profissional"
      items={[
        {
          id: "logout",
          label: "Sair do painel",
          icon: <LogOut size={16} />,
          danger: true,
          onClick: handleLogout,
        },
      ]}
    />
  );

  return (
    <AppShell
      brandTitle="ContatoCerto"
      brandSubtitle="Painel do Profissional"
      navItems={navItems}
      userMenu={userMenu}
    >
      {children}
    </AppShell>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <DSPageHeader
      eyebrow="ContatoCerto"
      title={title}
      description={description}
      actions={action}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const label =
    ({
      draft: "Cadastro em preparação",
      active: "Cadastro ativo",
      suspended: "Cadastro suspenso",
    } as Record<string, string>)[status] ?? status;

  const variant =
    status === "active"
      ? "success"
      : status === "draft"
      ? "warning"
      : status === "suspended"
      ? "danger"
      : "neutral";

  return (
    <Badge variant={variant} pill>
      {label}
    </Badge>
  );
}
