import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 }}>
      <Switch
        id="available-now"
        label="Disponível agora para novos chamados"
        description="Seu perfil receberá prioridade nas buscas da próxima hora."
        defaultChecked
      />
      <Switch
        id="emergency"
        label="Atendimento em plantão 24 horas"
        description="Indica que você realiza reparos de urgência fora do horário comercial."
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 440 }}>
      <Switch
        id="switch-disabled-off"
        label="Modo de férias (Indisponível no plano)"
        description="Requer assinatura profissional ativa."
        disabled
      />
      <Switch
        id="switch-disabled-on"
        label="Garantia padrão de atendimento"
        description="Fixado por diretriz da plataforma."
        defaultChecked
        disabled
      />
    </div>
  ),
};
