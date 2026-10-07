import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Components/Checkbox",
  component: Checkbox,
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 440 }}>
      <Checkbox
        id="notifications"
        label="Receber notificações via WhatsApp"
        description="Enviaremos alertas quando um cliente solicitar contato na sua região."
        defaultChecked
      />
      <Checkbox
        id="terms"
        label="Concordo com os Termos de Uso"
        description="Garantia de atendimento e normas da plataforma ContatoCerto."
        required
      />
    </div>
  ),
};

export const WithError: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <Checkbox
        id="consent"
        label="Autorizo o compartilhamento do número comercial"
        error="É necessário autorizar para receber clientes."
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 440 }}>
      <Checkbox
        id="disabled-unchecked"
        label="Opção indisponível no plano atual"
        disabled
      />
      <Checkbox
        id="disabled-checked"
        label="Verificação de identidade obrigatória"
        defaultChecked
        disabled
      />
    </div>
  ),
};
