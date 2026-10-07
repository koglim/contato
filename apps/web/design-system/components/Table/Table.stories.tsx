import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "./Table";
import { Badge } from "../Badge";

const meta: Meta<typeof Table> = {
  title: "Components/Table",
  component: Table,
};

export default meta;
type Story = StoryObj<typeof Table>;

export const Default: Story = {
  render: () => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Serviço</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Área de Atendimento</TableHeaderCell>
          <TableHeaderCell>Atualizado em</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>Eletricista Residencial</TableCell>
          <TableCell><Badge variant="success">Ativo</Badge></TableCell>
          <TableCell>Sinop - Centro e Região</TableCell>
          <TableCell className="cc-tabular-nums">06/10/2026</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Instalação de Ar Condicionado</TableCell>
          <TableCell><Badge variant="neutral">Inativo</Badge></TableCell>
          <TableCell>Sinop - Todos os bairros</TableCell>
          <TableCell className="cc-tabular-nums">01/10/2026</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Padrão de Entrada Bifásico</TableCell>
          <TableCell><Badge variant="accent">Em análise</Badge></TableCell>
          <TableCell>Sinop e Sorriso</TableCell>
          <TableCell className="cc-tabular-nums">05/10/2026</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const Compact: Story = {
  render: () => (
    <Table compact>
      <TableHead>
        <TableRow>
          <TableHeaderCell>ID</TableHeaderCell>
          <TableHeaderCell>Origem</TableHeaderCell>
          <TableHeaderCell>Canal</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell className="cc-tabular-nums">#1024</TableCell>
          <TableCell>WhatsApp Inbound</TableCell>
          <TableCell>Meta Cloud API</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="cc-tabular-nums">#1025</TableCell>
          <TableCell>Formulário Web</TableCell>
          <TableCell>Painel Direto</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
