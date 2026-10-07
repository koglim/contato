import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { useToast } from "./Toast";
import { Button } from "../Button";

const meta: Meta = {
  title: "Components/Toast",
};

export default meta;
type Story = StoryObj;

function ToastDemo() {
  const { toast } = useToast();

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: "Informação atualizada",
            description: "Seu perfil foi sincronizado com sucesso.",
            variant: "info",
          })
        }
      >
        Disparar Info
      </Button>

      <Button
        variant="primary"
        onClick={() =>
          toast({
            title: "Perfil publicado!",
            description: "Agora você pode receber clientes na sua região.",
            variant: "success",
          })
        }
      >
        Disparar Sucesso
      </Button>

      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: "Assinatura expirando",
            description: "Faltam 3 dias para renovação do seu plano.",
            variant: "warning",
          })
        }
      >
        Disparar Aviso
      </Button>

      <Button
        variant="danger"
        onClick={() =>
          toast({
            title: "Erro ao salvar alterações",
            description: "Verifique sua conexão e tente novamente.",
            variant: "danger",
          })
        }
      >
        Disparar Erro
      </Button>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <ToastDemo />,
};
