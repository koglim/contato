import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Sheet } from "./Sheet";
import { Button } from "../Button";

const meta: Meta<typeof Sheet> = {
  title: "Components/Sheet",
  component: Sheet,
};

export default meta;
type Story = StoryObj<typeof Sheet>;

export const RightSide: Story = {
  render: () => (
    <Sheet
      trigger={<Button variant="secondary">Abrir Detalhes do Serviço</Button>}
      title="Eletricista Residencial"
      description="Configurações avançadas e tabela de horários de atendimento."
      side="right"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
          Defina as especialidades adicionais e requisitos para este serviço.
        </p>
        <Button variant="primary">Salvar Alterações</Button>
      </div>
    </Sheet>
  ),
};

export const LeftSide: Story = {
  render: () => (
    <Sheet
      trigger={<Button variant="secondary">Abrir Painel Esquerdo</Button>}
      title="Menu Lateral"
      description="Navegação em telas menores."
      side="left"
    >
      <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
        Conteúdo da navegação lateral.
      </p>
    </Sheet>
  ),
};
