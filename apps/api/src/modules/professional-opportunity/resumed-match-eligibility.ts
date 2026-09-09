// Historical ranks and delivery evidence never authorize a new contact by
// themselves. Revalidate every presentation/selection, including the first one.
export const resumedMatchEligibilitySql = `(
    matches.selected_at IS NULL
    AND EXISTS (
      SELECT 1 FROM professionals current_professional
      JOIN professional_services current_service ON current_service.professional_id = current_professional.id
      JOIN services catalog ON catalog.id = current_service.service_id
      JOIN search_requests request ON request.id = matches.search_request_id AND request.service_id = catalog.id
      WHERE current_professional.id = matches.professional_id
        AND current_professional.status = 'active' AND current_service.is_active AND catalog.is_active
        AND length(trim(current_professional.display_name)) >= 2
        AND length(trim(current_professional.slug)) > 0
        AND current_professional.phone_e164 ~ '^[+][1-9][0-9]{7,14}$'
        AND EXISTS (SELECT 1 FROM professional_service_areas area
          WHERE area.professional_id = current_professional.id
            AND ST_DWithin(area.center, request.location, area.radius_meters))
    )
)`;
