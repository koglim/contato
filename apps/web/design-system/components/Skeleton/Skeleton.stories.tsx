import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Skeleton } from "./Skeleton";
import { Card } from "../Card";

const meta: Meta<typeof Skeleton> = {
  title: "Components/Skeleton",
  component: Skeleton,
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  render: () => (
    <Card style={{ maxWidth: 400, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Skeleton circle width={40} height={40} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      <Skeleton width="100%" height={64} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Skeleton width={80} height={36} radius="3" />
        <Skeleton width={100} height={36} radius="3" />
      </div>
    </Card>
  ),
};
