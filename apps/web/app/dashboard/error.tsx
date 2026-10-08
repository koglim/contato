"use client";

import { PageShell } from "../../design-system/shell/PageShell";
import { ErrorState } from "../../design-system/components/ErrorState";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <PageShell width="narrow">
      <ErrorState
        title="Não foi possível carregar o painel"
        description="Verifique a conexão da API e tente novamente."
        onRetry={reset}
        retryLabel="Tentar novamente"
      />
    </PageShell>
  );
}
