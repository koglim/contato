import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Tabs } from "./Tabs";
import { Card } from "../Card";

const meta: Meta<typeof Tabs> = {
  title: "Components/Tabs",
  component: Tabs,
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 540 }}>
      <Tabs
        items={[
          {
            id: "overview",
            label: "Visão Geral",
            content: (
              <Card padding="default" style={{ marginTop: 16 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Resumo da Conta</h4>
                <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
                  Perfil publicado e pronto para receber clientes.
                </p>
              </Card>
            ),
          },
          {
            id: "services",
            label: "Serviços Cadastrados",
            content: (
              <Card padding="default" style={{ marginTop: 16 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Lista de Atividades</h4>
                <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
                  2 serviços ativos e disponíveis para seleção de clientes.
                </p>
              </Card>
            ),
          },
          {
            id: "billing",
            label: "Assinatura e Pagamentos",
            disabled: true,
            content: <div>Em manutenção</div>,
          },
        ]}
      />
    </div>
  ),
};
