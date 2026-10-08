import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { ErrorState } from "./ErrorState";

const meta: Meta<typeof ErrorState> = {
  title: "Components/ErrorState",
  component: ErrorState,
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <ErrorState
        title="Falha ao carregar oportunidades"
        description="Não foi possível sincronizar suas mensagens do canal no momento. Verifique sua conexão e tente novamente."
        onRetry={() => alert("Tentando recarregar...")}
      />
    </div>
  ),
};

export const PageLevelError: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <ErrorState
        headingLevel={1}
        title="Não foi possível carregar o painel"
        description="Verifique a conexão da API e tente novamente."
        onRetry={() => alert("Tentando recarregar...")}
      />
    </div>
  ),
};
