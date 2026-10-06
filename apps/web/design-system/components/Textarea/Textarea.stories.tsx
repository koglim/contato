import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Textarea } from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Components/Textarea",
  component: Textarea,
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <Textarea
        id="bio"
        label="Descrição do serviço"
        placeholder="Detalhe suas qualificações, experiência e serviços prestados..."
        helperText="Máximo de 500 caracteres recomendados."
      />
    </div>
  ),
};

export const WithError: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <Textarea
        id="bio-error"
        label="Descrição do serviço"
        defaultValue="Texto curto"
        error="A descrição deve conter no mínimo 20 caracteres."
        required
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <Textarea
        id="bio-disabled"
        label="Descrição arquivada"
        defaultValue="Serviços elétricos em geral executados até 2024."
        disabled
      />
    </div>
  ),
};
