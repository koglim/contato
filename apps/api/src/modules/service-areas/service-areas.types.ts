import type { CreateServiceAreaInput, ServiceAreaResponse } from "@contatocerto/shared";

export type ServiceAreaUpdateRecord = {
  label: string | null;
  city: string;
  state: string;
  country_code: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_primary: boolean;
};

export type ServiceAreasRepository = {
  professionalExists(professionalId: string): Promise<boolean>;
  listByProfessional(professionalId: string): Promise<ServiceAreaResponse[]>;
  findById(professionalId: string, areaId: string): Promise<ServiceAreaResponse | null>;
  create(professionalId: string, input: CreateServiceAreaInput): Promise<ServiceAreaResponse>;
  update(professionalId: string, areaId: string, input: ServiceAreaUpdateRecord): Promise<ServiceAreaResponse | null>;
  delete(professionalId: string, areaId: string): Promise<boolean>;
};
