import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Input } from "./Input";
import { Search } from "../../icons";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    id: "input-name",
    label: "Nome completo",
    placeholder: "Ex: João da Silva",
    helperText: "Informe seu nome como consta no registro profissional.",
  },
};

export const WithIcons: Story = {
  args: {
    id: "input-search",
    label: "Buscar profissional",
    placeholder: "Digite o serviço ou cidade...",
    leftIcon: <Search />,
  },
};

export const WithError: Story = {
  args: {
    id: "input-email",
    label: "E-mail de contato",
    defaultValue: "joao.invalido@",
    error: "Por favor, insira um endereço de e-mail válido.",
  },
};

export const Disabled: Story = {
  args: {
    id: "input-disabled",
    label: "Telefone cadastrado",
    defaultValue: "+55 (66) 99999-0000",
    disabled: true,
    helperText: "Telefone não pode ser alterado diretamente nesta tela.",
  },
};
