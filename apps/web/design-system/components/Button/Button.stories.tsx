import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Button } from "./Button";
import { ArrowRight } from "../../icons";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "tertiary", "danger", "link"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    loading: { control: "boolean" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    children: "Salvar alterações",
    variant: "primary",
    size: "md",
  },
};

export const Secondary: Story = {
  args: {
    children: "Cancelar",
    variant: "secondary",
    size: "md",
  },
};

export const Tertiary: Story = {
  args: {
    children: "Visualizar detalhes",
    variant: "tertiary",
    size: "md",
  },
};

export const Danger: Story = {
  args: {
    children: "Excluir serviço",
    variant: "danger",
    size: "md",
  },
};

export const WithIcons: Story = {
  args: {
    children: "Continuar",
    variant: "primary",
    size: "md",
    rightIcon: <ArrowRight />,
  },
};

export const Loading: Story = {
  args: {
    children: "Salvando...",
    variant: "primary",
    loading: true,
  },
};

export const Disabled: Story = {
  args: {
    children: "Indisponível",
    variant: "primary",
    disabled: true,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="tertiary">Tertiary / Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="link">Link Button</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <Button size="sm">Small (32px)</Button>
      <Button size="md">Medium (40px Default)</Button>
      <Button size="lg">Large (44px)</Button>
    </div>
  ),
};
