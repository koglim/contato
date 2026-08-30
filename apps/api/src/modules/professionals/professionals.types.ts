import type {
  CreateProfessionalInput,
  ListProfessionalsQuery,
  ProfessionalResponse,
  UpdateProfessionalInput,
} from "@contatocerto/shared";

export type CreateProfessionalRecord = CreateProfessionalInput & {
  slug: string;
};

export type ProfessionalsRepository = {
  create(input: CreateProfessionalRecord): Promise<ProfessionalResponse>;
  findById(id: string): Promise<ProfessionalResponse | null>;
  list(query: ListProfessionalsQuery): Promise<{ items: ProfessionalResponse[]; total: number }>;
  update(id: string, input: UpdateProfessionalInput): Promise<ProfessionalResponse | null>;
};
