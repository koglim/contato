import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Spinner } from "./Spinner";

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <Spinner size="sm" label="Carregando pequeno..." />
      <Spinner size="md" label="Carregando médio..." />
      <Spinner size="lg" label="Carregando grande..." />
    </div>
  ),
};
