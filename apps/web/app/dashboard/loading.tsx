import { PageShell } from "../../design-system/shell/PageShell";
import { Skeleton } from "../../design-system/components/Skeleton";
import { Stack } from "../../design-system/layout/Stack";

export default function DashboardLoading() {
  return (
    <PageShell width="standard">
      <div aria-label="Carregando painel" role="status">
        <Stack gap="6">
          <Skeleton height={80} radius="3" />
          <Skeleton height={140} radius="3" />
          <Skeleton height={180} radius="3" />
        </Stack>
      </div>
    </PageShell>
  );
}
