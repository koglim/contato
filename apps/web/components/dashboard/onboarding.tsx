"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClaimableProfessional } from "@contatocerto/shared";

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
    <section className="onboarding-entry">
      {hasClaimables ? (
        <div className="claimable-section" style={{ marginBottom: "2rem" }}>
          <p className="eyebrow">Perfil identificado</p>
          <h2>Encontramos perfil existente</h2>
          <p>Se você já possui cadastro no ContatoCerto com este número de WhatsApp, você pode assumir o perfil diretamente:</p>
          <div className="claimable-list" style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
            {claimableProfiles.map((item) => (
              <div key={item.id} className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem" }}>
                <div>
                  <strong style={{ fontSize: "1.1rem" }}>{item.display_name}</strong>
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", opacity: 0.8 }}>
                    ({item.status === "active" ? "Ativo" : item.status === "draft" ? "Rascunho" : "Suspenso"})
                  </span>
                </div>
                <button
                  type="button"
                  className="form-action"
                  disabled={claimingId === item.id}
                  onClick={() => handleClaim(item.id)}
                >
                  {claimingId === item.id ? "Reivindicando…" : "Este perfil é meu"}
                </button>
              </div>
            ))}
          </div>
          {claimError ? <p className="form-error" role="alert" style={{ marginTop: "0.5rem" }}>{claimError}</p> : null}
        </div>
      ) : null}

      <p className="eyebrow">{hasClaimables ? "Outra opção" : "Primeiros passos"}</p>
      <h1>{hasClaimables ? "Criar novo perfil" : "Crie seu perfil profissional"}</h1>
      <p>Cadastre os dados básicos. Depois você poderá adicionar serviços e áreas de atendimento antes de publicar.</p>
      <form className="panel form-grid" onSubmit={submit}>
        <label>Nome profissional<input name="display_name" required minLength={2} maxLength={255} /></label>
        <label>Telefone de contato<input name="phone_e164" type="tel" placeholder="+5566999999999" required /></label>
        <label>E-mail opcional<input name="email" type="email" /></label>
        <label className="form-full">Bio opcional<textarea name="bio" rows={4} maxLength={2000} /></label>
        <button className="form-action" disabled={pending}>{pending ? "Criando…" : "Criar perfil"}</button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
