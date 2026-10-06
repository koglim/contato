import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Box } from "./Box";
import { Stack } from "./Stack";
import { Inline } from "./Inline";
import { Grid } from "./Grid";
import { Container } from "./Container";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";

const meta: Meta = {
  title: "Layout/Primitives",
};

export default meta;
type Story = StoryObj;

export const StackExample: Story = {
  render: () => (
    <Stack gap="4" style={{ maxWidth: 440 }}>
      <Card padding="dense">
        <strong>Item 1 da Pilha</strong>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>Espaçamento vertical consistente.</p>
      </Card>
      <Card padding="dense">
        <strong>Item 2 da Pilha</strong>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>Espaçamento vertical consistente.</p>
      </Card>
      <Card padding="dense">
        <strong>Item 3 da Pilha</strong>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>Espaçamento vertical consistente.</p>
      </Card>
    </Stack>
  ),
};

export const InlineExample: Story = {
  render: () => (
    <Inline gap="3" align="center" wrap={true}>
      <Badge variant="neutral">Elétrica</Badge>
      <Badge variant="info">Sinop</Badge>
      <Badge variant="success">Disponível</Badge>
      <Badge variant="accent">Destaque</Badge>
      <Badge variant="warning">Pendente</Badge>
    </Inline>
  ),
};

export const GridExample: Story = {
  render: () => (
    <Grid columns="3" gap="4">
      <Card padding="dense">Coluna 1</Card>
      <Card padding="dense">Coluna 2</Card>
      <Card padding="dense">Coluna 3</Card>
    </Grid>
  ),
};

export const ContainerExample: Story = {
  render: () => (
    <Container width="standard">
      <Box padding="6" bg="surface" border="default" radius="3">
        <h3 style={{ margin: "0 0 8px 0" }}>Container Médio Centralizado</h3>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
          Layout com largura máxima controlada e padding seguro.
        </p>
      </Box>
    </Container>
  ),
};
