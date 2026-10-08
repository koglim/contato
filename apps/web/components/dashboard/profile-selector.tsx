"use client";

import { useState } from "react";
import type { DashboardProfile } from "../../lib/api/server";
import { Container } from "../../design-system/layout/Container";
import { Select } from "../../design-system/components/Select";

export function ProfileSelector({
  profiles,
  current,
}: {
  profiles: DashboardProfile[];
  current: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Container width="standard" padding>
      <div style={{ maxWidth: "360px", paddingTop: "var(--cc-space-4)" }}>
        <Select
          id="profile-selector"
          label="Perfil profissional"
          value={current}
          disabled={pending}
          onValueChange={async (value) => {
            setPending(true);
            const response = await fetch("/api/dashboard/profile", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: value }),
            });
            if (response.ok) {
              window.location.reload();
            } else {
              setPending(false);
            }
          }}
          options={profiles.map((profile) => ({
            value: profile.id,
            label: profile.display_name,
          }))}
        />
      </div>
    </Container>
  );
}
