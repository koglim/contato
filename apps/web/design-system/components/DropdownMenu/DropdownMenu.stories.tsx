import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { DropdownMenu } from "./DropdownMenu";
import { Button } from "../Button";
import { User, Settings, LogOut } from "../../icons";

const meta: Meta<typeof DropdownMenu> = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

export const Default: Story = {
  render: () => (
    <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
      <DropdownMenu
        trigger={<Button variant="secondary">Opções da Conta</Button>}
        items={[
          {
            id: "profile",
            label: "Ver Perfil Profissional",
            icon: <User />,
            onClick: () => console.log("perfil"),
          },
          {
            id: "settings",
            label: "Configurações e Áreas",
            icon: <Settings />,
            onClick: () => console.log("configurações"),
          },
          {
            id: "logout",
            label: "Sair do Painel",
            icon: <LogOut />,
            danger: true,
            onClick: () => console.log("sair"),
          },
        ]}
      />
    </div>
  ),
};
