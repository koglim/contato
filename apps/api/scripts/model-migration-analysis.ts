import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { routeConversationCommand } from "../src/modules/conversation-commands/conversation-command.router.js";
import { resolveProfessionalSelection } from "../src/modules/selection-command/professional-selection.resolver.js";
import {
  checkpointMetadataSchema, checkpointRowSchema,
  type CheckpointMetadata, type CheckpointRow, type CheckpointStep,
} from "./model-migration-checkpoint.js";

const metadataLine = z.object({ kind: z.literal("metadata"), value: checkpointMetadataSchema }).strict();
const rowLine = z.object({ kind: z.literal("row"), value: checkpointRowSchema }).strict();
type CaseRef = { case_id: string; category: string };
export type RuntimeCase = { case_id: string; message: string; pendingSlot: string | null };

// Synthetic displayed options, not a claim about production data. For these
// fixtures they exercise both the name and ordinal resolver paths. Any route
// that would need the database is marked as an attempt, never as a selection.
const SHOWN_SELECTION_FIXTURE = [
  { rankPosition: 1, displayName: "Ana Eletricista" },
  { rankPosition: 2, displayName: "João Encanador" },
];

function effectKind(decision: string | null, service: string | null, location: string | null,
  runtimeCase: RuntimeCase): string {
  if (decision === "search") return !service ? "needs_service" : !location ? "needs_location" : "search_ready";
  if (decision !== "delegate") return decision === "clarify" ? "clarification" : decision ?? "invalid_output";
  // Mirrors ContextualConversationService: a model-induced delegate outside
  // pending selection is not routed into SelectionCommandService.
  if (runtimeCase.pendingSlot !== "selection") return "clarification";
  const routed = routeConversationCommand(runtimeCase.message, {
    kind: "awaiting_selection", visibleMatchCount: SHOWN_SELECTION_FIXTURE.length,
  });
  if (routed.kind === "global_command") return "global_command";
  if (routed.kind === "invalid_selection") return "invalid_selection";
  if (routed.kind === "selection_command") return routed.command.kind === "show_more" ? "show_more" : "selection_attempt";
  const selected = resolveProfessionalSelection(runtimeCase.message, SHOWN_SELECTION_FIXTURE);
  return selected.kind === "selected" ? "selection_attempt"
    : selected.kind === "ambiguous" ? "ambiguous_selection" : "clarification";
}

export function effectiveRuntimeOutcome(row: CheckpointRow, runtimeCase: RuntimeCase) {
  assert.equal(row.case_id, runtimeCase.case_id, "Runtime fixture case mismatch");
  const expected_kind = effectKind(row.expected_decision, row.expected_service, row.expected_location, runtimeCase);
  const actual_kind = effectKind(row.actual_decision, row.actual_service, row.actual_location, runtimeCase);
  return { expected_kind, actual_kind,
    selection_attempt: actual_kind === "selection_attempt",
    effective_runtime_outcome_agreement: expected_kind === actual_kind && agreement(row).final_slots_agreement };
}

export function agreement(row: CheckpointRow) {
  const decision_agreement = row.expected_decision === row.actual_decision;
  const service_slot_agreement = row.expected_service === row.actual_service;
  const location_slot_agreement = row.expected_location === row.actual_location;
  const hypotheses_agreement = JSON.stringify(row.expected_hypotheses) === JSON.stringify(row.actual_hypotheses);
  const final_slots_agreement = service_slot_agreement && location_slot_agreement && hypotheses_agreement;
  return { decision_agreement, service_slot_agreement, location_slot_agreement,
    hypotheses_agreement, final_slots_agreement,
    controller_outcome_agreement: decision_agreement && final_slots_agreement };
}

export function loadCompleteCheckpoint(path: string, expected: CheckpointMetadata,
  plan: CheckpointStep[]): CheckpointRow[] {
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.endsWith("\n"), "Checkpoint has an unterminated line; analysis is read-only");
  const lines = raw.slice(0, -1).split("\n");
  assert.equal(lines.length, plan.length + 1, "Checkpoint must contain exactly the planned rows");
  const metadata = metadataLine.parse(JSON.parse(lines[0]!)).value;
  assert.deepEqual(metadata, checkpointMetadataSchema.parse(expected), "Checkpoint metadata mismatch");
  assert.equal(metadata.calls_planned, plan.length, "Checkpoint plan length mismatch");
  return lines.slice(1).map((line, index) => {
    const row = rowLine.parse(JSON.parse(line)).value;
    const step = plan[index]!;
    assert.equal(row.execution_order, index + 1, "Checkpoint execution_order is not contiguous");
    for (const field of ["case_id", "category", "variant", "model", "reasoning_effort",
      "expected_decision", "expected_service", "expected_location"] as const) {
      assert.equal(row[field], step[field], `Checkpoint ${field} mismatch at ${index + 1}`);
    }
    assert.deepEqual(row.expected_hypotheses, step.expected_hypotheses,
      `Checkpoint hypotheses mismatch at ${index + 1}`);
    return row;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function count(rows: CheckpointRow[], predicate: (row: CheckpointRow) => boolean): number {
  return rows.filter(predicate).length;
}

// Each canonical fixture category belongs to at most one display group. The raw
// categories are also reported so this mapping cannot conceal a weak case.
const CATEGORY_GROUPS: Record<string, string[]> = {
  typo: ["accents_missing"],
  semantic: ["strong_catalog_evidence", "semantic_hypothesis", "natural_location", "semantic"],
  colloquial_noisy: ["colloquial_portuguese", "noisy_portuguese"],
  informational: ["informational_question", "faq_in_context"],
  negation: ["negated_service", "negation", "negated_defect"],
  hypothetical: ["hypothetical", "hypothesis"],
  correction_location: ["correction_location_context", "correction"],
  correction_service: ["correction_service_context"],
  continuation_context: ["hypothesis_context", "city_only_continuation", "context_continuation"],
  confirmation: ["confirmation"],
  conflicting_evidence: ["conflicting_evidence"],
  injection_out_of_scope: ["out_of_scope_in_context", "injection"],
  short_whatsapp: ["short_whatsapp"],
  temporal_modifiers: ["trailing_discovery"],
  ambiguity: ["ambiguity"],
};

export function analyzeRows(rows: CheckpointRow[], metadata: CheckpointMetadata, runtimeCases: RuntimeCase[]) {
  const names = metadata.variants.map(item => item.name);
  assert.equal(names[0], "baseline", "First variant must be the baseline");
  assert.equal(new Set(names).size, names.length, "Duplicate variant");
  assert.equal(rows.length, metadata.calls_planned, "Incomplete checkpoint");
  assert.equal(rows.length % names.length, 0, "Unbalanced variant count");
  const caseMap = new Map<string, Map<string, CheckpointRow>>();
  for (const row of rows) {
    assert.ok(names.includes(row.variant), `Unexpected variant: ${row.variant}`);
    const byVariant = caseMap.get(row.case_id) ?? new Map<string, CheckpointRow>();
    assert.ok(!byVariant.has(row.variant), `Duplicate case/variant: ${row.case_id}/${row.variant}`);
    byVariant.set(row.variant, row);
    caseMap.set(row.case_id, byVariant);
  }
  assert.equal(caseMap.size, rows.length / names.length, "Missing case/variant");
  for (const byVariant of caseMap.values()) assert.equal(byVariant.size, names.length, "Missing variant for case");
  const caseRefs: CaseRef[] = [...caseMap].map(([case_id, byVariant]) =>
    ({ case_id, category: byVariant.get("baseline")!.category }));
  const runtimeById = new Map(runtimeCases.map(item => [item.case_id, item]));
  assert.equal(runtimeById.size, runtimeCases.length, "Duplicate runtime fixture");
  assert.equal(runtimeById.size, caseRefs.length, "Runtime fixture count mismatch");
  for (const item of caseRefs) assert.ok(runtimeById.has(item.case_id), `Missing runtime fixture: ${item.case_id}`);
  const effective = (row: CheckpointRow) => effectiveRuntimeOutcome(row, runtimeById.get(row.case_id)!);
  const byName = (name: string) => rows.filter(row => row.variant === name);
  const totals = Object.fromEntries(names.map(name => {
    const subset = byName(name);
    const sum = (field: "input_tokens" | "cached_input_tokens" | "output_tokens"
      | "reasoning_tokens" | "total_tokens" | "estimated_cost_usd") =>
      subset.reduce((total, row) => total + row[field], 0);
    return [name, {
      calls: subset.length,
      structural_valid: count(subset, row => row.structural_valid),
      proposal_semantic_agreement: count(subset, row => row.semantic_agreement),
      decision_agreement: count(subset, row => agreement(row).decision_agreement),
      service_slot_agreement: count(subset, row => agreement(row).service_slot_agreement),
      location_slot_agreement: count(subset, row => agreement(row).location_slot_agreement),
      hypotheses_agreement: count(subset, row => agreement(row).hypotheses_agreement),
      final_slots_agreement: count(subset, row => agreement(row).final_slots_agreement),
      controller_outcome_agreement: count(subset, row => agreement(row).controller_outcome_agreement),
      effective_runtime_outcome_agreement: count(subset, row => effective(row).effective_runtime_outcome_agreement),
      duration_ms_median: median(subset.map(row => row.duration_ms)),
      duration_ms_min: Math.min(...subset.map(row => row.duration_ms)),
      duration_ms_max: Math.max(...subset.map(row => row.duration_ms)),
      input_tokens: sum("input_tokens"), cached_input_tokens: sum("cached_input_tokens"),
      output_tokens: sum("output_tokens"), reasoning_tokens: sum("reasoning_tokens"),
      total_tokens: sum("total_tokens"),
      incomplete_count: count(subset, row => row.response_status === "incomplete"),
      request_error_count: count(subset, row => row.response_status === "request_error"),
      historical_estimated_cost_usd: sum("estimated_cost_usd"),
    }];
  }));
  const outcome = (case_id: string, name: string) =>
    agreement(caseMap.get(case_id)!.get(name)!).controller_outcome_agreement;
  const effectiveOutcome = (case_id: string, name: string) =>
    effective(caseMap.get(case_id)!.get(name)!).effective_runtime_outcome_agreement;
  const caseIds = caseRefs.map(item => item.case_id);
  const unanimous = {
    all_pass: caseRefs.filter(item => names.every(name => outcome(item.case_id, name))),
    all_fail: caseRefs.filter(item => names.every(name => !outcome(item.case_id, name))),
    terra_corrects_baseline: caseRefs.filter(item => !outcome(item.case_id, "baseline")
      && names.slice(1).some(name => outcome(item.case_id, name))),
    baseline_pass_terra_fails: caseRefs.filter(item => outcome(item.case_id, "baseline")
      && names.slice(1).some(name => !outcome(item.case_id, name))),
  };
  const regression_matrix = Object.fromEntries(names.slice(1).map(name => {
    const improved_vs_baseline = caseRefs.filter(item => !outcome(item.case_id, "baseline")
      && outcome(item.case_id, name));
    const regressed_vs_baseline = caseRefs.filter(item => outcome(item.case_id, "baseline")
      && !outcome(item.case_id, name));
    return [name, { improved_vs_baseline, regressed_vs_baseline,
      both_pass: caseIds.filter(id => outcome(id, "baseline") && outcome(id, name)).length,
      both_fail: caseIds.filter(id => !outcome(id, "baseline") && !outcome(id, name)).length }];
  }));
  const effective_regression_matrix = Object.fromEntries(names.slice(1).map(name => {
    const improved_vs_baseline = caseRefs.filter(item => !effectiveOutcome(item.case_id, "baseline")
      && effectiveOutcome(item.case_id, name));
    const regressed_vs_baseline = caseRefs.filter(item => effectiveOutcome(item.case_id, "baseline")
      && !effectiveOutcome(item.case_id, name));
    return [name, { improved_vs_baseline, regressed_vs_baseline,
      both_pass: caseIds.filter(id => effectiveOutcome(id, "baseline") && effectiveOutcome(id, name)).length,
      both_fail: caseIds.filter(id => !effectiveOutcome(id, "baseline") && !effectiveOutcome(id, name)).length }];
  }));
  const effective_unanimous = {
    all_pass: caseRefs.filter(item => names.every(name => effectiveOutcome(item.case_id, name))),
    all_fail: caseRefs.filter(item => names.every(name => !effectiveOutcome(item.case_id, name))),
  };
  const formerUnanimousFailureClassification = unanimous.all_fail.map(item => ({
    ...item, variants: Object.fromEntries(names.map(name => {
      const row = caseMap.get(item.case_id)!.get(name)!;
      const result = effective(row);
      return [name, { effective_runtime_outcome_agreement: result.effective_runtime_outcome_agreement,
        actual_kind: result.actual_kind, selection_attempt: result.selection_attempt }];
    })),
  }));
  const categoryPasses = (selected: CaseRef[]) => Object.fromEntries(names.map(name =>
    [name, { passes: selected.filter(item => outcome(item.case_id, name)).length, total: selected.length }]));
  const categories_raw = Object.fromEntries([...new Set(caseRefs.map(item => item.category))].sort()
    .map(category => [category, categoryPasses(caseRefs.filter(item => item.category === category))]));
  const listed = Object.values(CATEGORY_GROUPS).flat();
  assert.equal(new Set(listed).size, listed.length, "Category appears in multiple groups");
  const category_groups = Object.fromEntries(Object.entries(CATEGORY_GROUPS).map(([group, categories]) =>
    [group, { categories, variants: categoryPasses(caseRefs.filter(item => categories.includes(item.category))) }]));
  const other = caseRefs.filter(item => !listed.includes(item.category));
  if (other.length) category_groups.other = {
    categories: [...new Set(other.map(item => item.category))].sort(), variants: categoryPasses(other),
  };
  assert.deepEqual(Object.values(category_groups).map(group => group.variants.baseline!.total)
    .reduce((sum, total) => sum + total, 0), caseRefs.length, "Category coverage mismatch");
  return { mode: "offline_controller_outcome_analysis", model_calls: 0,
    corpus_sha256: metadata.corpus_sha256, prompt_sha256: metadata.prompt_sha256,
    schedule_sha256: metadata.schedule_sha256, calls: rows.length, cases: caseRefs.length,
    metrics_note: "proposal_semantic_agreement is unchanged; controller outcome compares decision and slots; effective runtime outcome applies deterministic post-controller routing without database or WhatsApp",
    effective_limitations: "Selection uses fixed synthetic shown options and no pending consent or database; search_ready means correct search intent and slots, not geocoder/matching success",
    cost_note: "Historical per-row estimate; not a current invoice or model-selection criterion",
    variants: totals, regression_matrix, effective_regression_matrix,
    categories_raw, category_groups, unanimous, effective_unanimous,
    former_unanimous_failure_classification: formerUnanimousFailureClassification };
}

export type ModelMigrationAnalysis = ReturnType<typeof analyzeRows>;

function formatCaseList(items: CaseRef[]): string {
  return items.length ? items.map(item => `${item.case_id} (${item.category})`).join(", ") : "nenhum";
}

export function renderMarkdown(report: ModelMigrationAnalysis): string {
  const names = Object.keys(report.variants);
  const lines = [
    "# Model Migration Eval v1 — análise offline do controller", "",
    `Checkpoint validado: ${report.calls} rows, ${report.cases} casos; novas chamadas ao modelo: ${report.model_calls}.`,
    "`proposal_semantic_agreement` é o `semantic_agreement` estrito original, sem mudança de critério.",
    "`controller_outcome_agreement` exige decisão e todos os slots finais iguais ao oráculo.", "",
    "## Resumo por variante", "",
    "| Variante | Estrutural | Proposal estrita | Decisão | Slots finais | Controller outcome | Effective runtime | Latência mediana (min–max) ms | Input / cache / output / reasoning / total | Incomplete / request_error | Custo histórico estimado USD |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...names.map(name => {
      const s = report.variants[name]!;
      return `| ${name} | ${s.structural_valid}/${s.calls} | ${s.proposal_semantic_agreement}/${s.calls} | ${s.decision_agreement}/${s.calls} | ${s.final_slots_agreement}/${s.calls} | ${s.controller_outcome_agreement}/${s.calls} | ${s.effective_runtime_outcome_agreement}/${s.calls} | ${s.duration_ms_median} (${s.duration_ms_min}–${s.duration_ms_max}) | ${s.input_tokens} / ${s.cached_input_tokens} / ${s.output_tokens} / ${s.reasoning_tokens} / ${s.total_tokens} | ${s.incomplete_count} / ${s.request_error_count} | ${s.historical_estimated_cost_usd.toFixed(6)} |`;
    }), "",
    "## Regressões por caso contra baseline", "",
    ...Object.entries(report.regression_matrix).flatMap(([name, matrix]) => [
      `### ${name}`, "",
      `Melhorou (${matrix.improved_vs_baseline.length}): ${formatCaseList(matrix.improved_vs_baseline)}.`, "",
      `Regrediu (${matrix.regressed_vs_baseline.length}): ${formatCaseList(matrix.regressed_vs_baseline)}.`, "",
      `Ambos passam: ${matrix.both_pass}; ambos falham: ${matrix.both_fail}.`, "",
    ]),
    "## Matriz effective runtime contra baseline", "",
    ...Object.entries(report.effective_regression_matrix).flatMap(([name, matrix]) => [
      `### ${name}`, "",
      `Melhorou (${matrix.improved_vs_baseline.length}): ${formatCaseList(matrix.improved_vs_baseline)}.`, "",
      `Regrediu (${matrix.regressed_vs_baseline.length}): ${formatCaseList(matrix.regressed_vs_baseline)}.`, "",
      `Ambos passam: ${matrix.both_pass}; ambos falham: ${matrix.both_fail}.`, "",
    ]),
    "## Resultado por grupo de categoria", "",
    `| Grupo | Categorias do corpus | ${names.join(" | ")} |`,
    `| --- | --- | ${names.map(() => "---:").join(" | ")} |`,
    ...Object.entries(report.category_groups).map(([group, entry]) =>
      `| ${group} | ${entry.categories.join(", ")} | ${names.map(name => `${entry.variants[name]!.passes}/${entry.variants[name]!.total}`).join(" | ")} |`),
    "", "O JSON local inclui também o resultado por categoria original, sem agrupamento.", "",
    "## Casos unânimes e divergentes", "",
    `Todas passam (${report.unanimous.all_pass.length}): ${formatCaseList(report.unanimous.all_pass)}.`, "",
    `Todas falham (${report.unanimous.all_fail.length}): ${formatCaseList(report.unanimous.all_fail)}.`, "",
    `Alguma Terra corrige baseline (${report.unanimous.terra_corrects_baseline.length}): ${formatCaseList(report.unanimous.terra_corrects_baseline)}.`, "",
    `Baseline passa e alguma Terra falha (${report.unanimous.baseline_pass_terra_fails.length}): ${formatCaseList(report.unanimous.baseline_pass_terra_fails)}.`, "",
    `Effective: todas passam (${report.effective_unanimous.all_pass.length}): ${formatCaseList(report.effective_unanimous.all_pass)}.`, "",
    `Effective: todas falham (${report.effective_unanimous.all_fail.length}): ${formatCaseList(report.effective_unanimous.all_fail)}.`, "",
    "Classificação das quatro falhas unânimes anteriores (sem texto bruto):", "",
    ...report.former_unanimous_failure_classification.map(item =>
      `- ${item.case_id}: ${Object.entries(item.variants).map(([name, result]) => `${name}=${result.actual_kind}/${result.effective_runtime_outcome_agreement ? "pass" : "fail"}`).join(", ")}`),
    "",
    "Casos em que todas falham exigem revisão de oráculo, prompt, schema e política do controller antes de fundamentar escolha de modelo.",
    "A simulação usa opções exibidas sintéticas; não consulta banco, geocoder, matching, consentimento pendente ou WhatsApp. `search_ready` não prova busca executada.",
    "O custo acima reproduz a estimativa histórica das rows; a tarifa atual depende do contexto e não foi usada para escolher variante.", "",
  ];
  return lines.join("\n");
}

export function writeAnalysisReports(directory: string, report: ModelMigrationAnalysis): void {
  writeFileSync(join(directory, "model-migration-v1-analysis.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(join(directory, "model-migration-v1-analysis.md"), renderMarkdown(report), "utf8");
}
