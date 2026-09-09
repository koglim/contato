// Versioned, deterministic policy. Only these trusted constants are interpolated
// into SQL; customer/location inputs remain bound parameters.
export const RANKING_POLICY = {
  version: "fair-v1",
  distanceBandMeters: 2_000,
  reputationPriorMean: 4,
  reputationPriorWeight: 5,
  reputationBandWidth: 0.5,
  exposureWindowDays: 7,
  customerWindowDays: 30,
  contactWeight: 3,
  customerRepeatWeight: 5,
} as const;

// candidate_areas is built from eligible service/coverage rows by the repository.
// Aggregations are set based, not an application query per candidate. The policy
// applies before LIMIT, so underexposed profiles outside yesterday's pool compete.
export const rankingCtes = `
  eligible AS MATERIALIZED (SELECT * FROM candidate_areas WHERE area_position = 1),
  exposures AS (
    SELECT m.professional_id,
      COUNT(*) FILTER (WHERE m.shown_at >= NOW() - INTERVAL '${RANKING_POLICY.exposureWindowDays} days')::integer AS recent_exposures,
      COUNT(*) FILTER (WHERE r.customer_id = $6)::integer AS customer_repeats
    FROM matches m
    JOIN eligible e ON e.professional_id = m.professional_id
    JOIN search_requests r ON r.id = m.search_request_id
    WHERE m.shown_at >= NOW() - INTERVAL '${RANKING_POLICY.customerWindowDays} days'
    GROUP BY m.professional_id
  ), recent_contacts AS (
    SELECT c.professional_id, COUNT(*)::integer AS recent_contacts
    FROM contacts c JOIN eligible e ON e.professional_id = c.professional_id
    WHERE c.created_at >= NOW() - INTERVAL '${RANKING_POLICY.exposureWindowDays} days'
    GROUP BY c.professional_id
  ), reputation AS (
    SELECT r.professional_id, COUNT(*)::integer AS review_count, SUM(r.rating)::integer AS rating_sum
    FROM reviews r
    JOIN eligible e ON e.professional_id = r.professional_id
    JOIN contacts c ON c.id = r.contact_id AND c.professional_id = r.professional_id AND c.customer_id = r.customer_id
    JOIN customers customer ON customer.id = r.customer_id
    JOIN professionals professional ON professional.id = r.professional_id
    WHERE r.status = 'published' AND c.status = 'completed'
      AND customer.phone_e164 <> professional.phone_e164
    GROUP BY r.professional_id
  ), signals AS (
    SELECT e.*, FLOOR(e.distance_meters / ${RANKING_POLICY.distanceBandMeters}.0)::integer AS distance_band,
      COALESCE(x.recent_exposures, 0) AS recent_exposures,
      COALESCE(x.customer_repeats, 0) AS customer_repeats,
      COALESCE(c.recent_contacts, 0) AS recent_contacts,
      COALESCE(r.review_count, 0) AS review_count,
      (COALESCE(r.rating_sum, 0) + ${RANKING_POLICY.reputationPriorMean * RANKING_POLICY.reputationPriorWeight}.0)
        / (COALESCE(r.review_count, 0) + ${RANKING_POLICY.reputationPriorWeight}) AS bayesian_reputation
    FROM eligible e
    LEFT JOIN exposures x ON x.professional_id = e.professional_id
    LEFT JOIN recent_contacts c ON c.professional_id = e.professional_id
    LEFT JOIN reputation r ON r.professional_id = e.professional_id
  ), ranked AS (
    SELECT signals.*,
      FLOOR(bayesian_reputation / ${RANKING_POLICY.reputationBandWidth})::integer AS reputation_band,
      recent_exposures::bigint + recent_contacts::bigint * ${RANKING_POLICY.contactWeight}
        + customer_repeats::bigint * ${RANKING_POLICY.customerRepeatWeight} AS exposure_load
    FROM signals
  )`;

export const rankingOrder = `effective_available_now DESC, distance_band ASC, is_verified DESC,
  reputation_band DESC, exposure_load ASC, bayesian_reputation DESC, distance_meters ASC, professional_id ASC`;
