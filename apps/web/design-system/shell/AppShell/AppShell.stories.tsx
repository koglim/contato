import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { AppShell } from "./AppShell";
import { Home, Briefcase, MapPin, Sliders, User, LogOut, Moon, Sun } from "../../icons";
import { PageShell, PageHeader, PageSection } from "../";
import { Card, Button, Badge, Switch, Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "../../components";
import { useTheme } from "../../theme";

const meta: Meta<typeof AppShell> = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="tertiary"
      size="sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      leftIcon={resolvedTheme === "dark" ? <Sun /> : <Moon />}
    >
      {resolvedTheme === "dark" ? "Modo Claro" : "Modo Escuro"}
    </Button>
  );
}

export const FullDashboardDemo: Story = {
  render: () => {
    const navItems = [
      { id: "dash", label: "Visão Geral", icon: <Home />, active: true },
      { id: "services", label: "Meus Serviços", icon: <Briefcase />, badge: <Badge variant="neutral" size="sm">4</Badge> },
      { id: "areas", label: "Áreas de Atuação", icon: <MapPin /> },
      { id: "availability", label: "Disponibilidade", icon: <Sliders /> },
      { id: "profile", label: "Dados do Perfil", icon: <User /> },
    ];

    const userMenu = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: 13 }}>Lucas Eletricista</strong>
          <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Sinop - MT</span>
        </div>
        <Button variant="tertiary" size="sm" aria-label="Sair">
          <LogOut style={{ width: 16, height: 16 }} />
        </Button>
      </div>
    );

    return (
      <AppShell
        navItems={navItems}
        userMenu={userMenu}
        headerActions={<ThemeToggle />}
      >
        <PageShell width="standard">
          <PageHeader
            eyebrow="PAINEL DO PROFISSIONAL"
            title="Visão Geral da Conta"
            description="Acompanhe seu status operacional, disponibilidade no WhatsApp e histórico recente de atendimentos."
            actions={
              <Button variant="primary" size="md">
                Gerenciar Serviços
              </Button>
            }
          />

          <PageSection>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <Card padding="default">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--cc-text-secondary)" }}>Status do Perfil</span>
                  <Badge variant="success">Ativo</Badge>
                </div>
                <h3 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Elegível</h3>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--cc-text-muted)" }}>
                  Recebendo solicitações normalmente
                </p>
              </Card>

              <Card padding="default">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--cc-text-secondary)" }}>Atendimento Hoje</span>
                  <Badge variant="accent">Online</Badge>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14 }}>Disponível no WhatsApp</span>
                  <Switch defaultChecked />
                </div>
              </Card>

              <Card padding="default">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--cc-text-secondary)" }}>Conexões este mês</span>
                  <Badge variant="neutral">Bilateral v2</Badge>
                </div>
                <h3 style={{ margin: 0, fontSize: 24, fontWeight: 600 }} className="cc-tabular-nums">18</h3>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--cc-text-muted)" }}>
                  14 concluídos com sucesso
                </p>
              </Card>
            </div>
          </PageSection>

          <PageSection title="Últimas Conexões Bilaterais" description="Contatos recentes compartilhados após consentimento mútuo.">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Código</TableHeaderCell>
                  <TableHeaderCell>Serviço</TableHeaderCell>
                  <TableHeaderCell>Local</TableHeaderCell>
                  <TableHeaderCell>Data</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><code style={{ fontWeight: 600 }}>CC-FAWLXH56</code></TableCell>
                  <TableCell>Troca de Disjuntor</TableCell>
                  <TableCell>Sinop / MT</TableCell>
                  <TableCell className="cc-tabular-nums">06/10/2026</TableCell>
                  <TableCell><Badge variant="success" size="sm">Concluído</Badge></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code style={{ fontWeight: 600 }}>CC-VSYSUGHP</code></TableCell>
                  <TableCell>Instalação Padrão</TableCell>
                  <TableCell>Sinop / MT</TableCell>
                  <TableCell className="cc-tabular-nums">05/10/2026</TableCell>
                  <TableCell><Badge variant="info" size="sm">Em andamento</Badge></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </PageSection>
        </PageShell>
      </AppShell>
    );
  },
};
