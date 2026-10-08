import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Components/Checkbox",
  component: Checkbox,
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 440 }}>
      <Checkbox
        id="notifications"
        label="Receber notificações via WhatsApp"
        description="Enviaremos alertas quando um cliente solicitar contato na sua região."
        defaultChecked
      />
      <Checkbox
        id="terms"
        label="Concordo com os Termos de Uso"
        description="Garantia de atendimento e normas da plataforma ContatoCerto."
        required
      />
    </div>
  ),
};

export const WithError: Story = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <Checkbox
        id="consent"
        label="Autorizo o compartilhamento do número comercial"
        error="É necessário autorizar para receber clientes."
      />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 440 }}>
      <Checkbox
        id="disabled-unchecked"
        label="Opção indisponível no plano atual"
        disabled
      />
      <Checkbox
        id="disabled-checked"
        label="Verificação de identidade obrigatória"
        defaultChecked
        disabled
      />
    </div>
  ),
};

export const NativeFormIntegration: Story = {
  render: () => {
    function FormDemo() {
      const [submitted, setSubmitted] = React.useState<Record<string, string> | null>(null);
      return (
        <form
          style={{ maxWidth: 440, display: "flex", flexDirection: "column", gap: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const entries: Record<string, string> = {};
            formData.forEach((val, key) => {
              entries[key] = String(val);
            });
            setSubmitted(entries);
          }}
        >
          <Checkbox
            id="terms"
            name="accept_terms"
            value="accepted"
            label="Concordo com os termos"
            defaultChecked
          />
          <Checkbox
            id="newsletter"
            name="newsletter"
            label="Receber novidades por e-mail (default value 'on')"
          />
          <button type="submit" style={{ padding: "8px 16px", cursor: "pointer", alignSelf: "flex-start" }}>
            Enviar formulário
          </button>
          {submitted ? (
            <pre data-testid="checkbox-form-result" style={{ fontSize: 12, background: "var(--cc-bg-muted)", padding: 8 }}>
              {JSON.stringify(submitted, null, 2)}
            </pre>
          ) : null}
        </form>
      );
    }
    return <FormDemo />;
  },
};
