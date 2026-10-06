import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Header } from "./Header";
import { Button } from "../../components/Button";

const meta: Meta<typeof Header> = {
  title: "Shell/Header",
  component: Header,
};

export default meta;
type Story = StoryObj<typeof Header>;

export const Default: Story = {
  render: () => (
    <Header
      title="Painel do Profissional"
      onMenuToggle={() => console.log("toggle menu")}
      actions={<Button variant="primary" size="sm">Novo Serviço</Button>}
    />
  ),
};
