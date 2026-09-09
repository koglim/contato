// Historical matches retain their ranks and delivery evidence. After a refusal,
// eligibility is read again, never inferred from the original score snapshot.
export const resumedMatchEligibilitySql = `(
  NOT EXISTS (SELECT 1 FROM contacts declined
    WHERE declined.search_request_id = matches.search_request_id AND declined.status = 'declined'
      AND declined.bilateral_snapshot IS NOT NULL)
  OR (
    matches.selected_at IS NULL
    AND EXISTS (
      SELECT 1 FROM professionals current_professional
      JOIN professional_services current_service ON current_service.professional_id = current_professional.id
      JOIN services catalog ON catalog.id = current_service.service_id
      JOIN search_requests request ON request.id = matches.search_request_id AND request.service_id = catalog.id
      WHERE current_professional.id = matches.professional_id
        AND current_professional.status = 'active' AND current_service.is_active AND catalog.is_active
        AND EXISTS (SELECT 1 FROM professional_service_areas area
          WHERE area.professional_id = current_professional.id
            AND ST_DWithin(area.center, request.location, area.radius_meters))
    )
  )
)`;
