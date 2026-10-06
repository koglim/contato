import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { PageShell } from "./PageShell";
import { PageHeader } from "../PageHeader";
import { PageSection } from "../PageSection";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

const meta: Meta<typeof PageShell> = {
  title: "Shell/PageShell",
  component: PageShell,
};

export default meta;
type Story = StoryObj<typeof PageShell>;

export const Default: Story = {
  render: () => (
    <PageShell width="standard">
      <PageHeader
        eyebrow="PAINEL DO PROFISSIONAL"
        title="Meus Serviços"
        description="Gerencie as atividades profissionais exibidas para os clientes em Sinop e região."
        actions={<Button variant="primary">Adicionar Serviço</Button>}
      />

      <PageSection
        title="Serviços Ativos"
        description="Serviços atualmente participando de buscas determinísticas."
        actions={<Button variant="secondary" size="sm">Filtrar</Button>}
      >
        <Card padding="default">
          <h3 style={{ margin: "0 0 8px 0" }}>Eletricista Residencial e Comercial</h3>
          <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
            Atendimento disponível e verificado.
          </p>
        </Card>
      </PageSection>
    </PageShell>
  ),
};
