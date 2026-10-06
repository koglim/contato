import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Tooltip } from "./Tooltip";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { HelpCircle } from "../../icons";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Tooltip",
  component: Tooltip,
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 40 }}>
      <Tooltip content="Limite máximo de 6 profissionais por busca de cliente." side="top">
        <Button variant="secondary">Regra de Distribuição</Button>
      </Tooltip>

      <Tooltip content="Ajuda sobre a plataforma" side="right">
        <IconButton
          icon={<HelpCircle />}
          aria-label="Ajuda sobre a plataforma"
          variant="tertiary"
        />
      </Tooltip>
    </div>
  ),
};
