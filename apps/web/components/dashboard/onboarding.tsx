"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ProfessionalOnboarding() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

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

  return <section className="onboarding-entry">
    <p className="eyebrow">Primeiros passos</p>
    <h1>Crie seu perfil profissional</h1>
    <p>Cadastre os dados básicos. Depois você poderá adicionar serviços e áreas de atendimento antes de publicar.</p>
    <form className="panel form-grid" onSubmit={submit}>
      <label>Nome profissional<input name="display_name" required minLength={2} maxLength={255} /></label>
      <label>Telefone de contato<input name="phone_e164" type="tel" placeholder="+5566999999999" required /></label>
      <label>E-mail opcional<input name="email" type="email" /></label>
      <label className="form-full">Bio opcional<textarea name="bio" rows={4} maxLength={2000} /></label>
      <button className="form-action" disabled={pending}>{pending ? "Criando…" : "Criar perfil"}</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  </section>;
}
