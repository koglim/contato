import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { AccountMenu } from "./AccountMenu";
import { User, Settings, LogOut } from "../../icons";

const meta: Meta<typeof AccountMenu> = {
  title: "Shell/AccountMenu",
  component: AccountMenu,
};

export default meta;
type Story = StoryObj<typeof AccountMenu>;

const menuItems = [
  {
    id: "profile",
    label: "Meu Perfil",
    icon: <User />,
    onClick: () => console.log("perfil"),
  },
  {
    id: "settings",
    label: "Configurações",
    icon: <Settings />,
    onClick: () => console.log("configurações"),
  },
  {
    id: "logout",
    label: "Sair",
    icon: <LogOut />,
    danger: true,
    onClick: () => console.log("sair"),
  },
];

export const Expanded: Story = {
  render: () => (
    <div style={{ width: 240, padding: 16 }}>
      <AccountMenu
        name="Ricardo Santos"
        email="ricardo@exemplo.com.br"
        initials="RS"
        items={menuItems}
      />
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ width: 72, padding: 16, display: "flex", justifyContent: "center" }}>
      <AccountMenu
        name="Ricardo Santos"
        email="ricardo@exemplo.com.br"
        initials="RS"
        collapsed
        items={menuItems}
      />
    </div>
  ),
};
