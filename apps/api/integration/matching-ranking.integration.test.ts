import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";
import { RANKING_POLICY } from "../src/modules/matching/matching-ranking.js";

after(closeDatabaseConnection);

type Audit = {
  policy: typeof RANKING_POLICY;
  effective_available_now: boolean;
  distance_meters: number;
  distance_band: number;
  bayesian_reputation: number;
  reputation_band: number;
  review_count: number;
  recent_exposures: number;
  recent_contacts: number;
  customer_repeats: number;
  exposure_load: number;
  newcomer: boolean;
};

async function fixture(count = 4) {
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const customerId = randomUUID();
  const professionalIds = Array.from({ length: count }, () => randomUUID()).sort();
  const historyId = randomUUID();
  await withTransaction(async (client) => {
    await client.query("INSERT INTO service_categories (id, name, slug) VALUES ($1::uuid, 'Ranking test', $1::text)", [categoryId]);
    await client.query("INSERT INTO services (id, category_id, name, slug) VALUES ($1::uuid, $2, 'Ranking test', $1::text)", [serviceId, categoryId]);
    await client.query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, `+5566${BigInt(`0x${customerId.replaceAll("-", "").slice(0, 8)}`).toString().padStart(10, "0")}`]);
    await client.query("INSERT INTO search_requests (id, customer_id, service_id, raw_text) VALUES ($1, $2, $3, 'ranking history')", [historyId, customerId, serviceId]);
    for (const [i, id] of professionalIds.entries()) {
      await client.query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Ranking professional', $1::text, $2, 'active')", [id, `+556697${1000000 + i}`]);
      await client.query("INSERT INTO professional_services (professional_id, service_id) VALUES ($1, $2)", [id, serviceId]);
      await client.query(`INSERT INTO professional_service_areas (professional_id, city, state, country_code, center, radius_meters)
        VALUES ($1, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.5, -11.86), 4326)::geography, 20000)`, [id]);
    }
  });
  const search = async (customer?: string) => {
    const outcome = await new PostgresMatchingRepository().search({ service_id: serviceId, raw_text: "ranking test", latitude: -11.86, longitude: -55.5, limit: 3 }, { customerId: customer });
    assert.equal(outcome.kind, "success");
    if (outcome.kind !== "success") throw new Error("Expected successful matching");
    const rows = await query<{ professional_id: string; rank_position: number; score_breakdown: Audit }>(
      "SELECT professional_id, rank_position, score_breakdown FROM matches WHERE search_request_id = $1 ORDER BY rank_position", [outcome.response.search_request_id],
    );
    return rows.rows;
  };
  const exposure = (id: string, daysAgo = 0, shown = true) => query(
    `INSERT INTO matches (search_request_id, professional_id, rank_position, shown_at)
     VALUES ($1, $2, 1, CASE WHEN $3 THEN NOW() - ($4 * INTERVAL '1 day') ELSE NULL END)`, [historyId, id, shown, daysAgo],
  );
  const review = async (id: string, rating: number, status = "published", completed = true) => {
    await withTransaction(async (client) => {
      const contact = await client.query<{ id: string }>(
        `INSERT INTO contacts (search_request_id, customer_id, professional_id, status, created_at)
         VALUES ($1, $2, $3, $4, NOW() - INTERVAL '60 days') RETURNING id`, [historyId, customerId, id, completed ? "completed" : "requested"],
      );
      await client.query("INSERT INTO reviews (contact_id, customer_id, professional_id, rating, status) VALUES ($1, $2, $3, $4, $5)", [contact.rows[0].id, customerId, id, rating, status]);
    });
  };
  const cleanup = () => withTransaction(async (client) => {
    await client.query("DELETE FROM reviews WHERE contact_id IN (SELECT c.id FROM contacts c JOIN search_requests r ON r.id = c.search_request_id WHERE r.service_id = $1)", [serviceId]);
    await client.query("DELETE FROM contacts WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id = $1)", [serviceId]);
    await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id = $1)", [serviceId]);
    await client.query("DELETE FROM search_requests WHERE service_id = $1", [serviceId]);
    await client.query("DELETE FROM professional_service_areas WHERE professional_id = ANY($1::uuid[])", [professionalIds]);
    await client.query("DELETE FROM professional_services WHERE service_id = $1", [serviceId]);
    await client.query("DELETE FROM professionals WHERE id = ANY($1::uuid[])", [professionalIds]);
    await client.query("DELETE FROM services WHERE id = $1", [serviceId]);
    await client.query("DELETE FROM service_categories WHERE id = $1", [categoryId]);
    await client.query("DELETE FROM customers WHERE id = $1", [customerId]);
  });
  return { serviceId, customerId, professionalIds, historyId, search, exposure, review, cleanup };
}

test("ranking rotates comparable profiles outside the previous pool and persists its explanation", async () => {
  const current = await fixture(25);
  try {
    const first = await current.search();
    assert.deepEqual(first.map((row) => row.professional_id), current.professionalIds.slice(0, 20));
    assert.ok(first.every((row) => row.score_breakdown.bayesian_reputation === 4 && row.score_breakdown.newcomer));
    assert.deepEqual(first[0].score_breakdown.policy, RANKING_POLICY);
    assert.deepEqual(await current.search(), first, "unshown persisted candidates do not change ranking");
    for (const id of current.professionalIds.slice(0, 20)) await current.exposure(id);
    const rotated = await current.search();
    assert.deepEqual(rotated.slice(0, 5).map((row) => row.professional_id), current.professionalIds.slice(20));
    assert.equal(rotated[5].score_breakdown.recent_exposures, 1);
    assert.equal(rotated[5].score_breakdown.exposure_load, 1);
    assert.deepEqual(rotated.map((row) => row.rank_position), Array.from({ length: 20 }, (_, i) => i + 1));
  } finally { await current.cleanup(); }
});

test("ranking uses only confirmed recent exposure, contacts and customer-specific repetition", async () => {
  const current = await fixture();
  const [a, b, c, d] = current.professionalIds;
  try {
    await current.exposure(a, 20);
    await current.exposure(b, 31);
    await current.exposure(c, 0, false);
    await query("INSERT INTO contacts (search_request_id, customer_id, professional_id) VALUES ($1, $2, $3)", [current.historyId, current.customerId, d]);
    const anonymous = await current.search();
    assert.deepEqual(anonymous.map((row) => row.professional_id), [a, b, c, d]);
    assert.equal(anonymous[3].score_breakdown.exposure_load, 3);
    const repeated = await current.search(current.customerId);
    assert.deepEqual(repeated.map((row) => row.professional_id), [b, c, d, a]);
    assert.equal(repeated[3].score_breakdown.customer_repeats, 1);
    assert.equal(repeated[3].score_breakdown.exposure_load, 5);
    assert.ok(repeated.every((row) => row.score_breakdown.recent_exposures === 0));
  } finally { await current.cleanup(); }
});

test("Bayesian reputation protects newcomers and does not let one five-star review beat a solid history", async () => {
  const current = await fixture();
  const [one, established, newcomer, invalid] = current.professionalIds;
  try {
    await current.review(one, 5);
    for (let i = 0; i < 20; i += 1) await current.review(established, i < 16 ? 5 : 4);
    await current.review(invalid, 1, "hidden");
    await current.review(invalid, 1, "pending");
    await current.review(invalid, 5, "published", false);
    await current.exposure(established);
    const ranked = await current.search();
    assert.equal(ranked[0].professional_id, established);
    assert.equal(ranked[0].score_breakdown.bayesian_reputation, 4.64);
    assert.equal(ranked[0].score_breakdown.review_count, 20);
    const single = ranked.find((row) => row.professional_id === one)!;
    assert.ok(Math.abs(single.score_breakdown.bayesian_reputation - 25 / 6) < 0.000001);
    for (const id of [newcomer, invalid]) {
      const audit = ranked.find((row) => row.professional_id === id)!.score_breakdown;
      assert.equal(audit.review_count, 0);
      assert.equal(audit.bayesian_reputation, 4);
    }
  } finally { await current.cleanup(); }
});

test("fairness cannot overrule availability, distant coverage, verification or eligibility", async () => {
  const current = await fixture(8);
  const [available, near, far, verified, suspended, inactiveService, uncovered, incomplete] = current.professionalIds;
  try {
    await query("UPDATE professionals SET is_available_now = TRUE, available_now_updated_at = NOW() WHERE id = $1", [available]);
    await current.exposure(available);
    await current.exposure(near);
    await current.exposure(verified);
    await query("UPDATE professionals SET is_verified = TRUE WHERE id = $1", [verified]);
    await query("UPDATE professional_service_areas SET center = ST_SetSRID(ST_MakePoint(-55.5, -11.91), 4326)::geography WHERE professional_id = $1", [far]);
    await query("UPDATE professionals SET status = 'suspended' WHERE id = $1", [suspended]);
    await query("UPDATE professional_services SET is_active = FALSE WHERE professional_id = $1", [inactiveService]);
    await query("UPDATE professional_service_areas SET center = ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography WHERE professional_id = $1", [uncovered]);
    await query("UPDATE professionals SET phone_e164 = 'not-a-phone' WHERE id = $1", [incomplete]);
    const ranked = await current.search();
    assert.deepEqual(ranked.map((row) => row.professional_id), [available, verified, near, far]);
    assert.equal(ranked[0].score_breakdown.effective_available_now, true);
    assert.ok(ranked[3].score_breakdown.distance_band >= 2);
    await query("UPDATE professionals SET available_now_updated_at = NOW() - INTERVAL '5 hours' WHERE id = $1", [available]);
    assert.equal((await current.search())[0].professional_id, verified);
    await query("UPDATE services SET is_active = FALSE WHERE id = $1", [current.serviceId]);
    const inactive = await new PostgresMatchingRepository().search({ service_id: current.serviceId, raw_text: "test", latitude: -11.86, longitude: -55.5, limit: 3 });
    assert.deepEqual(inactive, { kind: "service_inactive" });
  } finally { await current.cleanup(); }
});
