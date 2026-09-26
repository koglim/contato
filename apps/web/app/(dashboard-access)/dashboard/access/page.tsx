import { AccessForm } from "../../../../components/dashboard/access-form";
import { professionalAuthEnabled } from "../../../../lib/auth/dashboard";

export default function DashboardAccessPage() {
  const passwordless=professionalAuthEnabled();
  return (
    <main className="access-page">
      <section className="access-panel" aria-labelledby="access-title">
        <p className="eyebrow">ContatoCerto · profissional</p>
        <h1 id="access-title">Seu trabalho, organizado.</h1>
        <p>Entre no painel para manter seu perfil disponível para novos clientes.</p>
        <AccessForm passwordless={passwordless} />
        {!passwordless?<small>Este acesso é temporário e será substituído pela autenticação do produto.</small>:null}
      </section>
    </main>
  );
}
