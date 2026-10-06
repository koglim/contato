import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Sidebar } from "./Sidebar";
import { Home, Briefcase, MapPin, Settings } from "../../icons";
import { Badge } from "../../components/Badge";

const meta: Meta<typeof Sidebar> = {
  title: "Shell/Sidebar",
  component: Sidebar,
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

const items = [
  { id: "overview", label: "Visão Geral", icon: <Home />, href: "/dashboard", active: true },
  { id: "services", label: "Serviços", icon: <Briefcase />, href: "/dashboard/services", badge: <Badge variant="neutral">2</Badge> },
  { id: "areas", label: "Áreas de Atuação", icon: <MapPin />, href: "/dashboard/areas" },
  { id: "settings", label: "Configurações", icon: <Settings />, onClick: () => console.log("settings") },
];

export const Expanded: Story = {
  render: () => (
    <div style={{ height: "100vh" }}>
      <Sidebar items={items} />
    </div>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ height: "100vh" }}>
      <Sidebar items={items} collapsed />
    </div>
  ),
};
