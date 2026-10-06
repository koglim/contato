import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Card } from "./Card";
import { Button } from "../Button";
import { Badge } from "../Badge";

const meta: Meta<typeof Card> = {
  title: "Components/Card",
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card padding="default" style={{ maxWidth: 440 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Eletricista Residencial</h3>
        <Badge variant="success">Ativo</Badge>
      </div>
      <p style={{ margin: "0 0 16px 0", color: "var(--cc-text-secondary)" }}>
        Instalação, manutenção de fiação, reparos em disjuntores e quadros de força.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="secondary" size="sm">Editar</Button>
      </div>
    </Card>
  ),
};

export const Interactive: Story = {
  render: () => (
    <Card variant="interactive" padding="default" style={{ maxWidth: 440 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Sinop e Região</h3>
      <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
        Raio de atendimento: 25 km a partir do centro.
      </p>
    </Card>
  ),
};

export const Selected: Story = {
  render: () => (
    <Card variant="selected" padding="default" style={{ maxWidth: 440 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>Plano Profissional Ativo</strong>
        <Badge variant="accent">Conta Gerenciada</Badge>
      </div>
      <p style={{ margin: "8px 0 0 0", color: "var(--cc-text-secondary)" }}>
        Recebimento contínuo de novas oportunidades pelo WhatsApp.
      </p>
    </Card>
  ),
};
