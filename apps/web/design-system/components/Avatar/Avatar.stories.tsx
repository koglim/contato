import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Components/Avatar",
  component: Avatar,
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Avatar size="24" initials="CC" alt="Avatar 24" />
      <Avatar size="32" initials="RS" alt="Avatar 32" />
      <Avatar size="40" initials="AP" alt="Avatar 40" />
      <Avatar size="48" initials="JD" alt="Avatar 48" />
      <Avatar size="64" initials="MK" alt="Avatar 64" />
    </div>
  ),
};

export const WithImage: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Avatar
        size="48"
        src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop"
        alt="Foto de perfil de Ana Paula"
        initials="AP"
      />
      <Avatar
        size="48"
        src="https://invalid-image-url-triggers-fallback.example.com/avatar.jpg"
        alt="Foto com fallback automático"
        initials="FL"
      />
    </div>
  ),
};
