import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { EmptyState } from "./EmptyState";
import { Briefcase } from "../../icons";
import { Button } from "../Button";

const meta: Meta<typeof EmptyState> = {
  title: "Components/EmptyState",
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <EmptyState
        icon={<Briefcase />}
        title="Nenhum serviço cadastrado"
        description="Adicione pelo menos um serviço para começar a receber contatos de clientes na sua cidade."
        action={<Button variant="primary">Cadastrar Primeiro Serviço</Button>}
      />
    </div>
  ),
};
