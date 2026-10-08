"use client";

import { useState } from "react";
import { formatDate } from "../../lib/formatters";
import { Card } from "../../design-system/components/Card";
import { Switch } from "../../design-system/components/Switch";
import { Badge } from "../../design-system/components/Badge";
import { InlineMessage } from "../../design-system/components/InlineMessage";

export function AvailabilityControl({
  initial,
  updatedAt,
  compact = false,
  canEnable = true,
  disabledReason,
}: {
  initial: boolean;
  updatedAt: string | null;
  compact?: boolean;
  canEnable?: boolean;
  disabledReason?: string;
}) {
  const [available, setAvailable] = useState(initial);
  const [timestamp, setTimestamp] = useState(updatedAt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !available;
    if (next && !canEnable) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "availability", data: { is_available_now: next } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAvailable(data.is_available_now);
      setTimestamp(data.available_now_updated_at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a disponibilidade.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padding={compact ? "dense" : "default"}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--cc-space-4)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: "var(--cc-space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "var(--cc-type-body-md-size)",
                fontWeight: "var(--cc-font-weight-semibold)",
                color: "var(--cc-text-primary)",
              }}
            >
              {available ? "Disponível agora" : "Indisponível no momento"}
            </h2>
            <Badge variant={available ? "success" : "neutral"} pill>
              {available ? "Disponível" : "Indisponível"}
            </Badge>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "var(--cc-type-body-sm-size)",
              color: available ? "var(--cc-action-primary)" : "var(--cc-text-secondary)",
              fontWeight: available ? "var(--cc-font-weight-medium)" : "normal",
            }}
          >
            {available ? "Você pode receber novos pedidos." : "Você não receberá novos pedidos agora."}
          </p>
          {!available && !canEnable && disabledReason ? (
            <p style={{ margin: 0, fontSize: "var(--cc-type-body-sm-size)", color: "var(--cc-text-secondary)" }}>
              {disabledReason}
            </p>
          ) : null}
          <p style={{ margin: 0, fontSize: "var(--cc-type-caption-size)", color: "var(--cc-text-muted)" }}>
            Última confirmação: {formatDate(timestamp)}
          </p>
        </div>
        <Switch
          id="availability-switch"
          checked={available}
          onCheckedChange={toggle}
          disabled={pending || (!available && !canEnable)}
          aria-label="Alternar disponibilidade"
        />
      </div>
      {error ? (
        <div style={{ marginTop: "var(--cc-space-3)" }}>
          <InlineMessage variant="danger">{error}</InlineMessage>
        </div>
      ) : null}
    </Card>
  );
}
