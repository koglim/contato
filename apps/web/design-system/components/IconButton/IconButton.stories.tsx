import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { IconButton } from "./IconButton";
import { Settings, Trash2, Edit, Plus } from "../../icons";

const meta: Meta<typeof IconButton> = {
  title: "Components/IconButton",
  component: IconButton,
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "tertiary", "danger"],
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
type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: {
    "aria-label": "Configurações",
    icon: <Settings />,
    variant: "secondary",
    size: "md",
  },
};

export const PrimaryAction: Story = {
  args: {
    "aria-label": "Adicionar novo item",
    icon: <Plus />,
    variant: "primary",
    size: "md",
  },
};

export const DangerAction: Story = {
  args: {
    "aria-label": "Excluir item",
    icon: <Trash2 />,
    variant: "danger",
    size: "md",
  },
};

export const LoadingState: Story = {
  args: {
    "aria-label": "Carregando dados",
    icon: <Edit />,
    loading: true,
  },
};
