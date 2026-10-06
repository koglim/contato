import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { RadioGroup } from "./Radio";

const meta: Meta<typeof RadioGroup> = {
  title: "Components/Radio",
  component: RadioGroup,
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

const options = [
  {
    value: "individual",
    label: "Profissional Autônomo",
    description: "Atendimento direto como pessoa física ou MEI.",
  },
  {
    value: "company",
    label: "Empresa de Serviços / Equipe",
    description: "Atendimento com CNPJ e múltiplos colaboradores técnicos.",
  },
  {
    value: "contractor",
    label: "Empreiteira Regional (Indisponível)",
    description: "Em fase de homologação para esta região.",
    disabled: true,
  },
];

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <RadioGroup
        name="profile-type"
        defaultValue="individual"
        options={options}
        ariaLabel="Tipo de atuação profissional"
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <RadioGroup
        name="profile-type-disabled"
        defaultValue="individual"
        options={options}
        disabled
        ariaLabel="Tipo de atuação profissional bloqueado"
      />
    </div>
  ),
};
