import type { Meta, StoryObj } from "@storybook/react";
import { InlineMessage } from "./InlineMessage";

const meta = {
  title: "Components/InlineMessage",
  component: InlineMessage,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["info", "success", "warning", "danger"],
    },
    children: {
      control: "text",
    },
  },
} satisfies Meta<typeof InlineMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: {
    variant: "info",
    children: "Este campo será visível para os clientes no momento do contato.",
  },
};

export const Success: Story = {
  args: {
    variant: "success",
    children: "Telefone verificado com sucesso pelo WhatsApp.",
  },
};

export const Warning: Story = {
  args: {
    variant: "warning",
    children: "Seu perfil pode levar até 24 horas para ser revisado pela equipe.",
  },
};

export const Danger: Story = {
  args: {
    variant: "danger",
    children: "Este número já está em uso por outro profissional cadastrado.",
  },
};

export const LongContent: Story = {
  args: {
    variant: "info",
    children:
      "A alteração dos dados cadastrais principais requer confirmação adicional via código de segurança enviado por mensagem instantânea ou SMS antes de ser aplicada ao perfil público.",
  },
};

export const DarkTheme: Story = {
  args: {
    variant: "info",
    children: "Mensagem contextual exibida com sucesso em modo escuro.",
  },
  globals: {
    theme: "dark",
  },
};
