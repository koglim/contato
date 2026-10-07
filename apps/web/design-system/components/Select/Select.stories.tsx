import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Select } from "./Select";

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
};

export default meta;
type Story = StoryObj<typeof Select>;

const options = [
  { value: "electrician", label: "Eletricista Residencial" },
  { value: "plumber", label: "Encanador / Bombeiro Hidráulico" },
  { value: "painter", label: "Pintor e Acabamentos" },
  { value: "carpenter", label: "Marceneiro e Montador", disabled: true },
];

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Select
        label="Especialidade Principal"
        options={options}
        placeholder="Selecione sua atividade principal"
        helperText="Você pode adicionar outras categorias no perfil."
      />
    </div>
  ),
};

export const WithError: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Select
        label="Especialidade Principal"
        options={options}
        placeholder="Selecione uma opção"
        error="Campo obrigatório para publicação do perfil."
        required
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Select
        label="Especialidade Principal"
        options={options}
        defaultValue="electrician"
        disabled
      />
    </div>
  ),
};
