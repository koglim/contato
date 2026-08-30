import type { ServiceResolutionResponse } from "@contatocerto/shared";
import { query } from "../../database/connection.js";
import { normalizeServiceText } from "./service-resolution.normalization.js";
import {
  FUZZY_AMBIGUITY_GAP,
  FUZZY_MIN_TERM_LENGTH,
  FUZZY_SIMILARITY_THRESHOLD,
  type ServiceResolutionRepository,
} from "./service-resolution.types.js";

type CandidateRow = { id: string; name: string; slug: string; term: string; confidence?: number | string };
const DATABASE_NORMALIZED_TERM = "trim(regexp_replace(regexp_replace(lower(unaccent(%s)), '[[:punct:]]+', ' ', 'g'), '\\s+', ' ', 'g'))";

function termsCte() {
  return `service_terms AS (
    SELECT services.id, services.name, services.slug,
      ${DATABASE_NORMALIZED_TERM.replace("%s", "services.name")} AS term
    FROM services WHERE services.is_active = TRUE
    UNION ALL
    SELECT services.id, services.name, services.slug,
      ${DATABASE_NORMALIZED_TERM.replace("%s", "services.slug")} AS term
    FROM services WHERE services.is_active = TRUE
    UNION ALL
    SELECT services.id, services.name, services.slug, service_aliases.normalized_alias AS term
    FROM service_aliases JOIN services ON services.id = service_aliases.service_id
    WHERE services.is_active = TRUE
  )`;
}

function candidate(row: CandidateRow, method: "exact" | "phrase" | "fuzzy") {
  return {
    service: { id: row.id, name: row.name, slug: row.slug },
    method,
    matched_term: row.term,
    confidence: method === "fuzzy" ? Number(row.confidence) : 1,
  };
}

function unresolved(normalizedText: string): ServiceResolutionResponse {
  return { status: "unresolved", normalized_text: normalizedText, match: null, candidates: [] };
}

function ambiguous(normalizedText: string, rows: CandidateRow[], method: "exact" | "phrase" | "fuzzy"): ServiceResolutionResponse {
  return { status: "ambiguous", normalized_text: normalizedText, match: null, candidates: rows.slice(0, 3).map((row) => candidate(row, method)) };
}

export class PostgresServiceResolutionRepository implements ServiceResolutionRepository {
  async resolve(input: { text: string }): Promise<ServiceResolutionResponse> {
    const normalizedText = normalizeServiceText(input.text);
    const exact = await query<CandidateRow>(
      `WITH ${termsCte()}
       SELECT DISTINCT ON (id) id, name, slug, term FROM service_terms
       WHERE term = $1 ORDER BY id, length(term) DESC`,
      [normalizedText],
    );
    if (exact.rows.length === 1) return { status: "resolved", normalized_text: normalizedText, match: candidate(exact.rows[0], "exact"), candidates: [] };
    if (exact.rows.length > 1) return ambiguous(normalizedText, exact.rows, "exact");

    const phrase = await query<CandidateRow>(
      `WITH ${termsCte()}
       SELECT DISTINCT ON (id) id, name, slug, term FROM service_terms
       WHERE position(' ' || term || ' ' IN ' ' || $1 || ' ') > 0
       ORDER BY id, length(term) DESC
       LIMIT 3`,
      [normalizedText],
    );
    if (phrase.rows.length === 1) return { status: "resolved", normalized_text: normalizedText, match: candidate(phrase.rows[0], "phrase"), candidates: [] };
    if (phrase.rows.length > 1) return ambiguous(normalizedText, phrase.rows, "phrase");

    const fuzzy = await query<CandidateRow>(
      `WITH ${termsCte()}, input_terms AS (
         SELECT token FROM regexp_split_to_table($1, '\\s+') AS token
         WHERE length(token) >= $2
       ), fuzzy_candidates AS (
         SELECT service_terms.id, service_terms.name, service_terms.slug, service_terms.term,
           MAX(similarity(service_terms.term, input_terms.token)) AS confidence
         FROM service_terms JOIN input_terms ON position(' ' IN service_terms.term) = 0
         WHERE length(service_terms.term) >= $2
           AND similarity(service_terms.term, input_terms.token) >= $3
         GROUP BY service_terms.id, service_terms.name, service_terms.slug, service_terms.term
       ), best_per_service AS (
         SELECT DISTINCT ON (id) id, name, slug, term, confidence FROM fuzzy_candidates
         ORDER BY id, confidence DESC, length(term) DESC
       )
       SELECT id, name, slug, term, confidence FROM best_per_service
       ORDER BY confidence DESC, id ASC LIMIT 3`,
      [normalizedText, FUZZY_MIN_TERM_LENGTH, FUZZY_SIMILARITY_THRESHOLD],
    );
    if (!fuzzy.rows.length) return unresolved(normalizedText);
    const top = Number(fuzzy.rows[0].confidence);
    const second = fuzzy.rows[1] ? Number(fuzzy.rows[1].confidence) : undefined;
    if (second !== undefined && top - second <= FUZZY_AMBIGUITY_GAP) return ambiguous(normalizedText, fuzzy.rows, "fuzzy");
    return { status: "resolved", normalized_text: normalizedText, match: candidate(fuzzy.rows[0], "fuzzy"), candidates: [] };
  }
}
