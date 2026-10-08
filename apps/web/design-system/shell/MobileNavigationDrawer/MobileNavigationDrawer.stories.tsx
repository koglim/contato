import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { Home, Briefcase, MapPin, Settings } from "../../icons";
import { Button } from "../../components/Button";
import { Badge } from "../../components/Badge";
import { AccountMenu } from "../AccountMenu";

const meta: Meta<typeof MobileNavigationDrawer> = {
  title: "Shell/MobileNavigationDrawer",
  component: MobileNavigationDrawer,
};

export default meta;
type Story = StoryObj<typeof MobileNavigationDrawer>;

const items = [
  { id: "overview", label: "Visão Geral", icon: <Home />, href: "/dashboard", active: true },
  { id: "services", label: "Serviços", icon: <Briefcase />, href: "/dashboard/services", badge: <Badge variant="neutral">2</Badge> },
  { id: "areas", label: "Áreas de Atuação", icon: <MapPin />, href: "/dashboard/areas" },
  { id: "settings", label: "Configurações", icon: <Settings />, onClick: () => console.log("settings") },
];

function DrawerDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Abrir Drawer de Navegação</Button>
      <MobileNavigationDrawer
        open={open}
        onOpenChange={setOpen}
        items={items}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <DrawerDemo />,
};

export const WithUserMenu: Story = {
  render: () => {
    function DrawerUserMenuDemo() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <Button onClick={() => setOpen(true)}>Abrir Drawer com Menu</Button>
          <MobileNavigationDrawer
            open={open}
            onOpenChange={setOpen}
            items={items}
            footer={
              <AccountMenu
                name="Lucas Eletricista"
                email="lucas@sinop.com.br"
                initials="LE"
                items={[
                  { id: "logout", label: "Sair", danger: true, onClick: () => {} },
                ]}
              />
            }
          />
        </div>
      );
    }
    return <DrawerUserMenuDemo />;
  },
};
