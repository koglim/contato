import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Badge } from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      <Badge variant="neutral">Neutro / Rascunho</Badge>
      <Badge variant="info">Em Análise</Badge>
      <Badge variant="success">Verificado</Badge>
      <Badge variant="warning">Atenção</Badge>
      <Badge variant="danger">Bloqueado</Badge>
      <Badge variant="accent">Destaque</Badge>
    </div>
  ),
};

export const Pills: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <Badge variant="success" pill>Disponível</Badge>
      <Badge variant="danger" pill>Indisponível</Badge>
      <Badge variant="neutral" pill>Offline</Badge>
    </div>
  ),
};
