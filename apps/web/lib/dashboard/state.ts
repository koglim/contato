import type { ProfessionalServiceResponse, ServiceAreaResponse } from "@contatocerto/shared";

export function upsertService(items: ProfessionalServiceResponse[], updated: ProfessionalServiceResponse) {
  const exists = items.some((item) => item.id === updated.id);
  return exists ? items.map((item) => item.id === updated.id ? updated : item) : [...items, updated];
}

export function upsertArea(items: ServiceAreaResponse[], updated: ServiceAreaResponse) {
  const synchronized = updated.is_primary ? items.map((item) => item.id === updated.id ? updated : { ...item, is_primary: false }) : items.map((item) => item.id === updated.id ? updated : item);
  return synchronized.some((item) => item.id === updated.id) ? synchronized : [...synchronized, updated];
}
