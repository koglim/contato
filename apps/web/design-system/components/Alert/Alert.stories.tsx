import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Alert } from "./Alert";
import { InlineMessage } from "../InlineMessage";

const meta: Meta<typeof Alert> = {
  title: "Components/Feedback/Alert",
  component: Alert,
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const InfoAlert: Story = {
  args: {
    variant: "info",
    title: "Atualização de Políticas",
    children: "Novas diretrizes de atendimento bilateral foram ativadas na plataforma.",
  },
};

export const SuccessAlert: Story = {
  args: {
    variant: "success",
    title: "Perfil Verificado",
    children: "Seu cadastro foi validado com sucesso e você já está apto a receber oportunidades.",
  },
};

export const WarningAlert: Story = {
  args: {
    variant: "warning",
    title: "Assinatura Próxima do Vencimento",
    children: "Seu plano expira em 3 dias. Verifique seu status para não interromper novos contatos.",
  },
};

export const DangerAlert: Story = {
  args: {
    variant: "danger",
    title: "Atendimento Suspenso",
    children: "Detectamos divergências no cadastro. Entre em contato com o suporte.",
  },
};

export const InlineMessages: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <InlineMessage variant="info">Dica: Adicione fotos para aumentar sua taxa de escolha.</InlineMessage>
      <InlineMessage variant="success">Disponibilidade atualizada em tempo real.</InlineMessage>
      <InlineMessage variant="warning">Área de cobertura excede o raio recomendado.</InlineMessage>
      <InlineMessage variant="danger">Não foi possível salvar os serviços selecionados.</InlineMessage>
    </div>
  ),
};
