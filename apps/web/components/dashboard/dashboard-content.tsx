"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type {
  ProfessionalEligibility,
  ProfessionalEntitlementSnapshot,
  ProfessionalResponse,
  ProfessionalServiceResponse,
  ServiceAreaResponse,
  ServiceCatalogItem,
} from "@contatocerto/shared";
import { formatKilometers, formatPrice } from "../../lib/formatters";
import { AvailabilityControl } from "./availability-control";
import { PageHeader, StatusBadge } from "./shell";
import { upsertArea, upsertService } from "../../lib/dashboard/state";
import { PageShell } from "../../design-system/shell/PageShell";
import { Card } from "../../design-system/components/Card";
import { Button } from "../../design-system/components/Button";
import { Input } from "../../design-system/components/Input";
import { Textarea } from "../../design-system/components/Textarea";
import { Select } from "../../design-system/components/Select";
import { Checkbox } from "../../design-system/components/Checkbox";
import { Badge } from "../../design-system/components/Badge";
import { Alert } from "../../design-system/components/Alert";
import { InlineMessage } from "../../design-system/components/InlineMessage";
import { EmptyState } from "../../design-system/components/EmptyState";
import { AlertDialog } from "../../design-system/components/AlertDialog";
import { Stack } from "../../design-system/layout/Stack";
import { Grid } from "../../design-system/layout/Grid";
import { Briefcase, MapPin } from "../../design-system/icons";

type Data = {
  professional: ProfessionalResponse;
  services: ProfessionalServiceResponse[];
  areas: ServiceAreaResponse[];
  catalog: ServiceCatalogItem[];
  eligibility: ProfessionalEligibility;
  entitlement?: ProfessionalEntitlementSnapshot;
};

type PriceMode = "quote" | "fixed" | "from" | "range";

async function save(action: string, data?: unknown, id?: string, method = "PATCH") {
  const response = await fetch("/api/dashboard", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, id, data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a alteração.");
  return body;
}

function Feedback({ value, error }: { value: string; error?: boolean }) {
  if (!value) return null;
  return (
    <InlineMessage variant={error ? "danger" : "success"}>
      {value}
    </InlineMessage>
  );
}

export function DashboardContent({
  section,
  data,
  selfServiceLifecycleEnabled,
}: {
  section: "overview" | "profile" | "services" | "areas" | "availability";
  data: Data;
  selfServiceLifecycleEnabled: boolean;
}) {
  if (section === "profile") {
    return <Profile data={data.professional} selfServiceLifecycleEnabled={selfServiceLifecycleEnabled} />;
  }

  if (section === "services") {
    return <Services items={data.services} catalog={data.catalog} />;
  }

  if (section === "areas") {
    return <Areas items={data.areas} />;
  }

  const availabilityReason =
    data.eligibility.profile_status === "suspended"
      ? "O perfil está suspenso pela equipe."
      : data.eligibility.profile_status !== "active"
      ? "Publique o perfil antes de ativar a disponibilidade."
      : "Complete o perfil, um serviço ativo e uma área de atendimento.";

  const availabilityPolicy = selfServiceLifecycleEnabled
    ? { canEnable: data.eligibility.can_set_available_now, disabledReason: availabilityReason }
    : {};

  if (section === "availability") {
    return (
      <PageShell width="standard">
        <Stack gap="6">
          <PageHeader
            title="Disponibilidade"
            description="Confirme quando estiver pronto para receber novos pedidos."
          />
          <AvailabilityControl
            initial={data.professional.is_available_now}
            updatedAt={data.professional.available_now_updated_at}
            {...availabilityPolicy}
          />
        </Stack>
      </PageShell>
    );
  }

  const primary = data.areas.find((area) => area.is_primary);
  const mainService = data.services.find((service) => service.is_active);
  const activeCount = data.services.filter((item) => item.is_active).length;

  return (
    <PageShell width="standard">
      <Stack gap="6">
        <PageHeader
          title={`Olá, ${data.professional.display_name.split(" ")[0]}`}
          description="Acompanhe os pontos essenciais do seu cadastro."
        />

        {selfServiceLifecycleEnabled &&
        data.professional.status === "active" &&
        !data.eligibility.ready_to_publish ? (
          <Alert variant="warning">
            Seu perfil está publicado, mas deixou de atender aos requisitos atuais. Revise o checklist para voltar a receber oportunidades.
          </Alert>
        ) : null}

        {selfServiceLifecycleEnabled &&
        data.professional.status === "active" &&
        data.eligibility.ready_to_publish &&
        data.entitlement &&
        !data.entitlement.has_marketplace_access ? (
          <Alert variant="warning">
            Seu perfil está publicado, mas não está participando de novas buscas porque não há assinatura ativa.
          </Alert>
        ) : null}

        {selfServiceLifecycleEnabled ? <EligibilityCard eligibility={data.eligibility} /> : null}

        {selfServiceLifecycleEnabled && data.entitlement ? (
          <SubscriptionCard entitlement={data.entitlement} />
        ) : null}

        <AvailabilityControl
          compact
          initial={data.professional.is_available_now}
          updatedAt={data.professional.available_now_updated_at}
          {...availabilityPolicy}
        />

        <Grid columns="3" gap="4">
          <Card padding="default">
            <Stack gap="2">
              <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                Cadastro
              </p>
              <div>
                <StatusBadge status={data.professional.status} />
              </div>
              <strong style={{ fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
                {activeCount} serviço{activeCount === 1 ? "" : "s"} ativo{activeCount === 1 ? "" : "s"}
              </strong>
            </Stack>
          </Card>

          <Card padding="default">
            <Stack gap="2">
              <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                Área principal
              </p>
              <strong style={{ fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
                {primary ? `${primary.city}, ${primary.state}` : "Ainda não definida"}
              </strong>
              <span style={{ fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                {primary ? formatKilometers(primary.radius_meters) : "Defina onde você atende"}
              </span>
            </Stack>
          </Card>

          <Card padding="default">
            <Stack gap="2">
              <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                Serviço em destaque
              </p>
              <strong style={{ fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
                {mainService?.service.name ?? "Nenhum serviço cadastrado"}
              </strong>
              <span style={{ fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                {mainService
                  ? formatPrice(mainService.price_mode, mainService.price_from_cents, mainService.price_to_cents)
                  : "Adicione seu primeiro serviço"}
              </span>
            </Stack>
          </Card>
        </Grid>
      </Stack>
    </PageShell>
  );
}

function SubscriptionCard({ entitlement }: { entitlement: ProfessionalEntitlementSnapshot }) {
  if (entitlement.state === "legacy_exempt") {
    return (
      <Card padding="default">
        <Stack gap="2">
          <h2 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
            Assinatura
          </h2>
          <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
            Perfil legado isento de assinatura no momento.
          </p>
        </Stack>
      </Card>
    );
  }

  if (entitlement.state === "active") {
    const formattedEndsAt = entitlement.ends_at
      ? new Date(entitlement.ends_at).toLocaleDateString("pt-BR", { timeZone: "UTC" })
      : null;
    return (
      <Card padding="default">
        <Stack gap="2">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
            <h2 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
              Assinatura ativa
            </h2>
            <Badge variant="success" pill>Ativa</Badge>
          </div>
          <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
            Seu perfil pode participar do marketplace enquanto os demais requisitos estiverem válidos.
          </p>
          {formattedEndsAt ? (
            <small style={{ color: "var(--cc-text-muted)" }}>Vigência até {formattedEndsAt}</small>
          ) : null}
        </Stack>
      </Card>
    );
  }

  const isExpired = entitlement.state === "expired";
  const title = isExpired ? "Assinatura expirada" : "Assinatura necessária";
  return (
    <Card padding="default">
      <Stack gap="2">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)", color: "var(--cc-text-primary)" }}>
            {title}
          </h2>
          <Badge variant={isExpired ? "danger" : "warning"} pill>
            {isExpired ? "Expirada" : "Pendente"}
          </Badge>
        </div>
        <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
          Seu perfil e seus dados continuam disponíveis. Para receber novos clientes, é necessária uma assinatura ativa.
        </p>
        <small style={{ color: "var(--cc-text-muted)" }}>
          Pagamento online será habilitado em uma próxima etapa.
        </small>
      </Stack>
    </Card>
  );
}

function EligibilityCard({ eligibility }: { eligibility: ProfessionalEligibility }) {
  const [status, setStatus] = useState(eligibility.profile_status);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const items = [
    [eligibility.identity_verified, "Identidade verificada", undefined],
    [eligibility.profile_complete, "Perfil básico", "/dashboard/profile"],
    [eligibility.has_active_service, "Adicionar pelo menos um serviço", "/dashboard/services"],
    [eligibility.has_service_area, "Definir uma área de atendimento", "/dashboard/service-areas"],
  ] as const;

  async function lifecycle(action: "publish" | "unpublish") {
    setPending(true);
    setMessage("");
    try {
      await save(action, undefined, undefined, "POST");
      setStatus(action === "publish" ? "active" : "draft");
      setMessage(action === "publish" ? "Perfil publicado." : "Perfil despublicado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o perfil.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padding="default">
      <Stack gap="4">
        <div>
          <h2 style={{ margin: "0 0 var(--cc-space-1) 0", fontSize: "var(--cc-font-size-lg)" }}>
            Prepare seu perfil para publicar
          </h2>
          <p style={{ margin: 0, color: "var(--cc-text-secondary)" }}>
            O checklist acompanha o estado atual do cadastro.
          </p>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--cc-space-2)" }}>
          {items.map(([done, label, href]) => (
            <li
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--cc-space-2)",
                color: done ? "var(--cc-action-primary)" : "var(--cc-text-secondary)",
                fontWeight: done ? "var(--cc-font-weight-medium)" : "normal",
              }}
            >
              <span aria-hidden="true">{done ? "✓" : "○"}</span>
              {href && !done ? (
                <Link href={href} style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>
                  {label}
                </Link>
              ) : (
                label
              )}
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-3)", flexWrap: "wrap" }}>
          {status === "draft" && eligibility.ready_to_publish ? (
            <Button variant="primary" loading={pending} onClick={() => lifecycle("publish")}>
              Publicar perfil
            </Button>
          ) : null}

          {status === "active" ? (
            <>
              <Badge variant="success" pill>
                Perfil publicado
              </Badge>
              <Button variant="secondary" loading={pending} onClick={() => lifecycle("unpublish")}>
                Despublicar perfil
              </Button>
            </>
          ) : null}

          {status === "suspended" ? (
            <InlineMessage variant="danger">Perfil suspenso pela equipe.</InlineMessage>
          ) : null}
        </div>

        {message ? <InlineMessage variant="success">{message}</InlineMessage> : null}
      </Stack>
    </Card>
  );
}

function Profile({
  data,
  selfServiceLifecycleEnabled,
}: {
  data: ProfessionalResponse;
  selfServiceLifecycleEnabled: boolean;
}) {
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);
    const formData = new FormData(event.currentTarget);
    try {
      await save("profile", {
        display_name: formData.get("display_name"),
        email: formData.get("email") || null,
        bio: formData.get("bio") || null,
      });
      setIsError(false);
      setMessage("Alterações salvas.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    } finally {
      setPending(false);
    }
  }

  const statusCopy = selfServiceLifecycleEnabled
    ? {
        draft: "Este perfil ainda não está publicado.",
        active: "Este perfil está publicado.",
        suspended: "Suspenso pela equipe; o profissional não pode reativá-lo.",
      }[data.status]
    : "Gerenciado pela equipe do ContatoCerto.";

  return (
    <PageShell width="standard">
      <Stack gap="6">
        <PageHeader
          title="Perfil"
          description="Mantenha seus dados profissionais atualizados."
        />

        <Card padding="default">
          <form onSubmit={submit}>
            <Stack gap="4">
              <Grid columns="2" gap="4">
                <Input
                  id="display_name"
                  name="display_name"
                  label="Nome profissional"
                  defaultValue={data.display_name}
                  required
                />
                <Input
                  id="phone_e164"
                  name="phone_e164"
                  type="tel"
                  label="Telefone"
                  value={data.phone_e164}
                  readOnly
                  helperText="A alteração de telefone requer verificação pela equipe."
                />
              </Grid>

              <Grid columns="2" gap="4">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  label="E-mail"
                  defaultValue={data.email ?? ""}
                />
                <div style={{ display: "grid", gap: "var(--cc-space-1)" }}>
                  <span style={{ fontSize: "var(--cc-font-size-sm)", fontWeight: "var(--cc-font-weight-medium)" }}>
                    Status do cadastro
                  </span>
                  <div>
                    <StatusBadge status={data.status} />
                  </div>
                  <small style={{ color: "var(--cc-text-muted)" }}>{statusCopy}</small>
                </div>
              </Grid>

              <Textarea
                id="bio"
                name="bio"
                label="Sobre você"
                rows={5}
                defaultValue={data.bio ?? ""}
              />

              <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                Endereço do perfil:{" "}
                <code
                  style={{
                    backgroundColor: "var(--cc-bg-surface-muted)",
                    padding: "2px 6px",
                    borderRadius: "var(--cc-radius-2)",
                    fontFamily: "var(--cc-font-mono)",
                  }}
                >
                  /{data.slug}
                </code>
              </p>

              <div>
                <Button type="submit" variant="primary" loading={pending}>
                  Salvar alterações
                </Button>
              </div>

              <Feedback value={message} error={isError} />
            </Stack>
          </form>
        </Card>
      </Stack>
    </PageShell>
  );
}

function servicePayload(formData: FormData, mode: PriceMode) {
  const data: Record<string, unknown> = {
    description: formData.get("description") || null,
    price_mode: mode,
  };
  if (mode !== "quote") data.price_from_cents = Math.round(Number(formData.get("price_from")) * 100);
  if (mode === "range") data.price_to_cents = Math.round(Number(formData.get("price_to")) * 100);
  return data;
}

function PriceFields({
  mode,
  setMode,
  item,
}: {
  mode: PriceMode;
  setMode: (mode: PriceMode) => void;
  item?: ProfessionalServiceResponse;
}) {
  return (
    <>
      <Select
        id="price_mode"
        name="price_mode"
        label="Como cobra"
        value={mode}
        onValueChange={(val) => setMode(val as PriceMode)}
        options={[
          { value: "quote", label: "Sob consulta" },
          { value: "fixed", label: "Valor fixo" },
          { value: "from", label: "A partir de" },
          { value: "range", label: "Faixa de preço" },
        ]}
      />
      {mode !== "quote" ? (
        <Input
          id="price_from"
          name="price_from"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          label="Valor inicial (R$)"
          defaultValue={item?.price_from_cents ? String(item.price_from_cents / 100) : ""}
          required
        />
      ) : null}
      {mode === "range" ? (
        <Input
          id="price_to"
          name="price_to"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          label="Valor final (R$)"
          defaultValue={item?.price_to_cents ? String(item.price_to_cents / 100) : ""}
          required
        />
      ) : null}
    </>
  );
}

function Services({
  items,
  catalog,
}: {
  items: ProfessionalServiceResponse[];
  catalog: ServiceCatalogItem[];
}) {
  const [list, setList] = useState(items);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [mode, setMode] = useState<PriceMode>("quote");
  const [selectedServiceId, setSelectedServiceId] = useState(catalog[0]?.id ?? "");
  const [editing, setEditing] = useState<ProfessionalServiceResponse | null>(null);
  const [editingMode, setEditingMode] = useState<PriceMode>("quote");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const serviceId = (formData.get("service_id") as string) || selectedServiceId;
    const data = {
      ...servicePayload(formData, mode),
      description: formData.get("description") || undefined,
      service_id: serviceId,
    };
    setMessage("");
    try {
      const added = await save("service", data, undefined, "POST");
      setList((current) => upsertService(current, added));
      setIsError(false);
      setMessage("Serviço salvo.");
      (event.target as HTMLFormElement).reset();
      setMode("quote");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    } finally {
      setPending(false);
    }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setPending(true);
    const formData = new FormData(event.currentTarget);
    try {
      const updated = await save("service", servicePayload(formData, editingMode), editing.id);
      setList((current) => upsertService(current, updated));
      setEditing(null);
      setIsError(false);
      setMessage("Serviço atualizado.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    } finally {
      setPending(false);
    }
  }

  async function toggle(item: ProfessionalServiceResponse) {
    try {
      const updated = await save("service", { is_active: !item.is_active }, item.id);
      setList((current) => upsertService(current, updated));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao atualizar.");
    }
  }

  function startEditing(item: ProfessionalServiceResponse) {
    setEditing(item);
    setEditingMode(item.price_mode as PriceMode);
  }

  return (
    <PageShell width="standard">
      <Stack gap="6">
        <PageHeader
          title="Serviços"
          description="Informe o que você faz e como costuma cobrar."
        />

        <Stack gap="3">
          {list.length ? (
            list.map((item) => (
              <Card key={item.id} padding="default">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "var(--cc-space-4)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: "var(--cc-space-1)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
                      <h3 style={{ margin: 0, fontSize: "var(--cc-font-size-base)", fontWeight: "var(--cc-font-weight-semibold)" }}>
                        {item.service.name}
                      </h3>
                      <Badge variant={item.is_active ? "success" : "neutral"} pill>
                        {item.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                      {item.service.category.name} · {formatPrice(item.price_mode, item.price_from_cents, item.price_to_cents)}
                    </p>
                    <small style={{ color: "var(--cc-text-muted)" }}>
                      {item.description ?? "Sem descrição"}
                    </small>
                  </div>

                  <div style={{ display: "flex", gap: "var(--cc-space-2)" }}>
                    <Button variant="secondary" size="sm" onClick={() => startEditing(item)}>
                      Editar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => toggle(item)}>
                      {item.is_active ? "Desativar" : "Reativar"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon={<Briefcase size={36} />}
              title="Você ainda não adicionou serviços."
              description="Adicione os serviços que você realiza para começar a receber oportunidades."
            />
          )}
        </Stack>

        <Feedback value={message} error={isError} />

        {editing ? (
          <Card padding="default">
            <form onSubmit={update}>
              <Stack gap="4">
                <h3 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)" }}>
                  Editar {editing.service.name}
                </h3>
                <Grid columns="2" gap="4">
                  <PriceFields mode={editingMode} setMode={setEditingMode} item={editing} />
                </Grid>
                <Textarea
                  id="edit_description"
                  name="description"
                  label="Descrição"
                  rows={3}
                  defaultValue={editing.description ?? ""}
                />
                <div style={{ display: "flex", gap: "var(--cc-space-3)" }}>
                  <Button type="submit" variant="primary" loading={pending}>
                    Salvar serviço
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </Stack>
            </form>
          </Card>
        ) : (
          <Card padding="default">
            <form onSubmit={submit}>
              <Stack gap="4">
                <h3 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)" }}>
                  Adicionar serviço
                </h3>
                <Select
                  id="service_id"
                  name="service_id"
                  label="Serviço"
                  required
                  value={selectedServiceId}
                  onValueChange={setSelectedServiceId}
                  options={catalog.map((item) => ({
                    value: item.id,
                    label: `${item.name} — ${item.category.name}`,
                  }))}
                />
                <Grid columns="2" gap="4">
                  <PriceFields mode={mode} setMode={setMode} />
                </Grid>
                <Textarea
                  id="add_description"
                  name="description"
                  label="Descrição"
                  rows={3}
                />
                <div>
                  <Button type="submit" variant="primary" loading={pending}>
                    Adicionar serviço
                  </Button>
                </div>
              </Stack>
            </form>
          </Card>
        )}
      </Stack>
    </PageShell>
  );
}

function areaPayload(formData: FormData) {
  return {
    label: formData.get("label") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    country_code: formData.get("country_code"),
    neighborhood: formData.get("neighborhood") || null,
    latitude: Number(formData.get("latitude")),
    longitude: Number(formData.get("longitude")),
    radius_meters: Math.round(Number(formData.get("radius_km")) * 1000),
    is_primary: formData.get("is_primary") === "on",
  };
}

function AreaForm({
  item,
  onSave,
  onCancel,
}: {
  item?: ServiceAreaResponse;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [isPrimary, setIsPrimary] = useState(item?.is_primary ?? false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const payload = areaPayload(new FormData(event.currentTarget));
      payload.is_primary = isPrimary;
      await onSave(payload);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padding="default">
      <form onSubmit={submit}>
        <Stack gap="4">
          <h3 style={{ margin: 0, fontSize: "var(--cc-font-size-lg)" }}>
            {item ? "Editar área" : "Adicionar área"}
          </h3>

          <Input
            id="area_label"
            name="label"
            label="Nome da área"
            defaultValue={item?.label ?? ""}
            placeholder="Ex.: Sinop e região"
          />

          <Grid columns="2" gap="4">
            <Input
              id="area_city"
              name="city"
              label="Cidade"
              defaultValue={item?.city}
              required
            />
            <Input
              id="area_state"
              name="state"
              label="Estado"
              defaultValue={item?.state}
              required
              maxLength={120}
            />
          </Grid>

          <Grid columns="2" gap="4">
            <Input
              id="area_country"
              name="country_code"
              label="País"
              defaultValue={item?.country_code ?? "BR"}
              required
              maxLength={2}
            />
            <Input
              id="area_neighborhood"
              name="neighborhood"
              label="Bairro"
              defaultValue={item?.neighborhood ?? ""}
            />
          </Grid>

          <Input
            id="area_radius"
            name="radius_km"
            label="Raio (km)"
            defaultValue={item ? String(item.radius_meters / 1000) : ""}
            type="number"
            min="0.1"
            step="0.1"
            required
          />

          <fieldset
            style={{
              border: "1px solid var(--cc-border-subtle)",
              borderRadius: "var(--cc-radius-3)",
              padding: "var(--cc-space-4)",
              margin: 0,
            }}
          >
            <legend
              style={{
                padding: "0 var(--cc-space-2)",
                fontSize: "var(--cc-font-size-xs)",
                color: "var(--cc-text-secondary)",
              }}
            >
              Localização avançada
            </legend>
            <Grid columns="2" gap="4">
              <Input
                id="area_latitude"
                name="latitude"
                label="Latitude"
                defaultValue={item?.latitude}
                type="number"
                step="any"
                required
              />
              <Input
                id="area_longitude"
                name="longitude"
                label="Longitude"
                defaultValue={item?.longitude}
                type="number"
                step="any"
                required
              />
            </Grid>
          </fieldset>

          <Checkbox
            id="area_is_primary"
            name="is_primary"
            label="Definir como área principal"
            checked={isPrimary}
            onCheckedChange={setIsPrimary}
          />

          <div style={{ display: "flex", gap: "var(--cc-space-3)" }}>
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? "Salvando…" : item ? "Salvar área" : "Adicionar área"}
            </Button>
            {onCancel ? (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function Areas({ items }: { items: ServiceAreaResponse[] }) {
  const [list, setList] = useState(items);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [editing, setEditing] = useState<ServiceAreaResponse | null>(null);
  const [removing, setRemoving] = useState<ServiceAreaResponse | null>(null);

  async function add(data: Record<string, unknown>) {
    setMessage("");
    try {
      const added = await save("area", data, undefined, "POST");
      setList((current) => upsertArea(current, added));
      setIsError(false);
      setMessage("Área adicionada.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    }
  }

  async function update(data: Record<string, unknown>) {
    if (!editing) return;
    try {
      const changed = await save("area", data, editing.id);
      setList((current) => upsertArea(current, changed));
      setEditing(null);
      setIsError(false);
      setMessage("Área atualizada.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao salvar.");
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await save("area", undefined, removing.id, "DELETE");
      setList((current) => current.filter((item) => item.id !== removing.id));
      setRemoving(null);
      setIsError(false);
      setMessage("Área removida.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erro ao remover.");
    }
  }

  return (
    <PageShell width="standard">
      <Stack gap="6">
        <PageHeader
          title="Área de atendimento"
          description="Defina as regiões onde você pode atender."
        />

        <Stack gap="3">
          {list.length ? (
            list.map((item) => (
              <Card key={item.id} padding="default">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "var(--cc-space-4)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: "var(--cc-space-1)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-space-2)" }}>
                      <h3 style={{ margin: 0, fontSize: "var(--cc-font-size-base)", fontWeight: "var(--cc-font-weight-semibold)" }}>
                        {item.label ?? `${item.city}, ${item.state}`}
                      </h3>
                      {item.is_primary ? (
                        <Badge variant="accent" pill>
                          Área principal
                        </Badge>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, fontSize: "var(--cc-font-size-sm)", color: "var(--cc-text-secondary)" }}>
                      {item.city}, {item.state} · {formatKilometers(item.radius_meters)}
                    </p>
                    <small style={{ color: "var(--cc-text-muted)" }}>
                      {item.neighborhood ?? ""}
                    </small>
                  </div>

                  <div style={{ display: "flex", gap: "var(--cc-space-2)" }}>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(item)}>
                      Editar
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setRemoving(item)}>
                      Remover
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon={<MapPin size={36} />}
              title="Você ainda não definiu uma área de atendimento."
              description="Defina sua cidade e raio de atendimento para receber oportunidades próximas."
            />
          )}
        </Stack>

        <Feedback value={message} error={isError} />

        {editing ? (
          <AreaForm item={editing} onSave={update} onCancel={() => setEditing(null)} />
        ) : (
          <AreaForm onSave={add} />
        )}

        {removing ? (
          <AlertDialog
            open={Boolean(removing)}
            onOpenChange={(open) => !open && setRemoving(null)}
            title="Remover área?"
            description={`${removing.label ?? `${removing.city}, ${removing.state}`} deixará de receber solicitações nessa região.`}
            confirmLabel="Remover área"
            cancelLabel="Cancelar"
            onConfirm={remove}
            onCancel={() => setRemoving(null)}
            variant="danger"
          />
        ) : null}
      </Stack>
    </PageShell>
  );
}
