import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Dialog } from "./Dialog";
import { Button } from "../Button";
import { Input } from "../Input";

const meta: Meta<typeof Dialog> = {
  title: "Components/Overlay/Dialog",
  component: Dialog,
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => (
    <Dialog
      trigger={<Button variant="primary">Adicionar Nova Área</Button>}
      title="Nova Área de Atendimento"
      description="Selecione o município e o raio de abrangência para novos chamados."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input id="dlg-city" label="Município" defaultValue="Sinop" />
        <Input id="dlg-radius" label="Raio de atendimento (km)" defaultValue="20" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button variant="secondary">Cancelar</Button>
          <Button variant="primary">Confirmar e Salvar</Button>
        </div>
      </div>
    </Dialog>
  ),
};
