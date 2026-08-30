import Link from "next/link";
import { ReactNode } from "react";
import { DashboardNavigation } from "./navigation";

const navigation = [["Visão geral", "/dashboard"], ["Perfil", "/dashboard/profile"], ["Serviços", "/dashboard/services"], ["Área de atendimento", "/dashboard/service-areas"], ["Disponibilidade", "/dashboard/availability"]] as const;

export function DashboardShell({ children }: { children: ReactNode }) {
  return <div className="dashboard-shell"><aside className="sidebar"><Link className="brand" href="/dashboard"><span>cc</span> ContatoCerto</Link><DashboardNavigation items={navigation} /><p className="sidebar-note">Painel do profissional</p></aside><main id="main-content" className="dashboard-main">{children}</main></div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <header className="page-header"><div><p className="eyebrow">ContatoCerto</p><h1>{title}</h1><p>{description}</p></div>{action}</header>; }
export function StatusBadge({ status }: { status: string }) { const label = ({ draft: "Cadastro em preparação", active: "Cadastro ativo", suspended: "Cadastro suspenso" } as Record<string, string>)[status] ?? status; return <span className={`status status-${status}`}>{label}</span>; }
