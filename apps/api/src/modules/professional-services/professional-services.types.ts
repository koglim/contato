import type {
  CreateProfessionalServiceInput,
  PriceMode,
  ProfessionalServiceResponse,
} from "@contatocerto/shared";

export type CatalogServiceState = { id: string; is_active: boolean };

export type ProfessionalServiceUpdateRecord = {
  description: string | null;
  price_mode: PriceMode;
  price_from_cents: number | null;
  price_to_cents: number | null;
  is_active: boolean;
};

export type ProfessionalServicesRepository = {
  professionalExists(professionalId: string): Promise<boolean>;
  findService(serviceId: string): Promise<CatalogServiceState | null>;
  findByProfessionalAndService(professionalId: string, serviceId: string): Promise<ProfessionalServiceResponse | null>;
  findById(professionalId: string, professionalServiceId: string): Promise<ProfessionalServiceResponse | null>;
  listByProfessional(professionalId: string): Promise<ProfessionalServiceResponse[]>;
  create(professionalId: string, input: CreateProfessionalServiceInput): Promise<ProfessionalServiceResponse>;
  update(
    professionalId: string,
    professionalServiceId: string,
    input: ProfessionalServiceUpdateRecord,
  ): Promise<ProfessionalServiceResponse | null>;
};
