import type { z } from "zod";
import type {
  createProfessionalServiceSchema,
  listCatalogServicesQuerySchema,
  priceModeSchema,
  professionalServiceResponseSchema,
  serviceCatalogItemSchema,
  updateProfessionalServiceSchema,
} from "../schemas/professional-service.js";

export type CreateProfessionalServiceInput = z.infer<typeof createProfessionalServiceSchema>;
export type UpdateProfessionalServiceInput = z.infer<typeof updateProfessionalServiceSchema>;
export type ProfessionalServiceResponse = z.infer<typeof professionalServiceResponseSchema>;
export type PriceMode = z.infer<typeof priceModeSchema>;
export type ServiceCatalogItem = z.infer<typeof serviceCatalogItemSchema>;
export type ListCatalogServicesQuery = z.infer<typeof listCatalogServicesQuerySchema>;
