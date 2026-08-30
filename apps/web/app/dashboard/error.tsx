"use client";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <section className="panel error-panel"><h1>Não foi possível carregar o painel</h1><p>Verifique a conexão da API e tente novamente.</p><button className="form-action" onClick={reset}>Tentar novamente</button></section>;
}
