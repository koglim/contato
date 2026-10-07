import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { AlertDialog } from "./AlertDialog";
import { Button } from "../Button";

const meta: Meta<typeof AlertDialog> = {
  title: "Components/AlertDialog",
  component: AlertDialog,
};

export default meta;
type Story = StoryObj<typeof AlertDialog>;

export const Danger: Story = {
  render: () => (
    <AlertDialog
      trigger={<Button variant="danger">Despublicar Perfil</Button>}
      title="Tem certeza que deseja despublicar?"
      description="Ao despublicar, seu perfil deixará de aparecer em novas buscas de clientes em Sinop e região."
      confirmLabel="Sim, despublicar perfil"
      cancelLabel="Voltar"
      variant="danger"
      onConfirm={() => alert("Perfil despublicado")}
    />
  ),
};

export const PrimaryAction: Story = {
  render: () => (
    <AlertDialog
      trigger={<Button variant="primary">Confirmar Envio</Button>}
      title="Publicar Perfil Agora?"
      description="Seus serviços ficarão visíveis para solicitação imediata de clientes."
      confirmLabel="Publicar agora"
      cancelLabel="Revisar dados"
      variant="primary"
      onConfirm={() => alert("Perfil publicado")}
    />
  ),
};
