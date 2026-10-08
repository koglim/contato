"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClaimableProfessional } from "@contatocerto/shared";
import { PageShell } from "../../design-system/shell/PageShell";
import { PageHeader } from "../../design-system/shell/PageHeader";
import { Card } from "../../design-system/components/Card";
import { Button } from "../../design-system/components/Button";
import { Input } from "../../design-system/components/Input";
import { Textarea } from "../../design-system/components/Textarea";
import { Badge } from "../../design-system/components/Badge";
import { InlineMessage } from "../../design-system/components/InlineMessage";
import { Stack } from "../../design-system/layout/Stack";

export function ProfessionalOnboarding({
  claimableProfiles = [],
}: {
  claimableProfiles?: ClaimableProfessional[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");

  async function handleClaim(professionalId: string) {
    setClaimingId(professionalId);
    setClaimError("");
    try {
      const response = await fetch("/api/dashboard/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ professional_id: professionalId }),
      });
      if (!response.ok) {
        throw new Error("Não foi possível reivindicar o perfil. Tente novamente.");
      }
      router.refresh();
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : "Erro ao reivindicar perfil.");
      setClaimingId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    const payload = {
      display_name: values.get("display_name"),
      phone_e164: values.get("phone_e164"),
      ...(values.get("email") ? { email: values.get("email") } : {}),
      ...(values.get("bio") ? { bio: values.get("bio") } : {}),
    };
    try {
      const response = await fetch("/api/dashboard/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Não foi possível criar o perfil. Revise os dados e tente novamente.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o perfil.");
    } finally {
      setPending(false);
    }
  }

  const hasClaimables = claimableProfiles.length > 0;

  return (
    <PageShell width="narrow">
      <Stack gap="6">
        {hasClaimables ? (
          <section aria-labelledby="claimable-title">
            <PageHeader
              eyebrow="Perfil identificado"
              title="Encontramos perfil existente"
              description="Se você já possui cadastro no ContatoCerto com este número de WhatsApp, você pode assumir o perfil diretamente:"
            />
            <Stack gap="3" style={{ marginTop: "var(--cc-space-4)" }}>
              {claimableProfiles.map((item) => (
                <Card key={item.id} padding="default">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "var(--cc-space-3)",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
                      <strong style={{ fontSize: "var(--cc-font-size-base)" }}>{item.display_name}</strong>
                      <Badge
                        variant={item.status === "active" ? "success" : item.status === "draft" ? "warning" : "danger"}
                        pill
                      >
                        {item.status === "active" ? "Ativo" : item.status === "draft" ? "Rascunho" : "Suspenso"}
                      </Badge>
                    </div>
                    <Button
                      variant="primary"
                      loading={claimingId === item.id}
                      onClick={() => handleClaim(item.id)}
                    >
                      {claimingId === item.id ? "Reivindicando…" : "Este perfil é meu"}
                    </Button>
                  </div>
                </Card>
              ))}
            </Stack>
            {claimError ? (
              <div style={{ marginTop: "var(--cc-space-3)" }}>
                <InlineMessage variant="danger">{claimError}</InlineMessage>
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="onboarding-form-title">
          <PageHeader
            eyebrow={hasClaimables ? "Outra opção" : "Primeiros passos"}
            title={hasClaimables ? "Criar novo perfil" : "Crie seu perfil profissional"}
            description="Cadastre os dados básicos. Depois você poderá adicionar serviços e áreas de atendimento antes de publicar."
          />
          <Card padding="default" style={{ marginTop: "var(--cc-space-4)" }}>
            <form onSubmit={submit}>
              <Stack gap="4">
                <Input
                  id="display_name"
                  name="display_name"
                  label="Nome profissional"
                  required
                  minLength={2}
                  maxLength={255}
                />
                <Input
                  id="phone_e164"
                  name="phone_e164"
                  type="tel"
                  label="Telefone de contato"
                  placeholder="+5566999999999"
                  required
                />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  label="E-mail opcional"
                />
                <Textarea
                  id="bio"
                  name="bio"
                  label="Bio opcional"
                  rows={4}
                  maxLength={2000}
                />
                <div>
                  <Button type="submit" variant="primary" loading={pending}>
                    {pending ? "Criando…" : "Criar perfil"}
                  </Button>
                </div>
                {error ? <InlineMessage variant="danger">{error}</InlineMessage> : null}
              </Stack>
            </form>
          </Card>
        </section>
      </Stack>
    </PageShell>
  );
}
