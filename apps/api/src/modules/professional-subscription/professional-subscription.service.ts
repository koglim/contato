import type {
  ExtendProfessionalSubscriptionInput,
  GrantProfessionalSubscriptionInput,
  ProfessionalEntitlementSnapshot,
  ReactivateProfessionalSubscriptionInput,
} from "@contatocerto/shared";
import { PostgresProfessionalSubscriptionRepository } from "./professional-subscription.repository.js";

export class ProfessionalSubscriptionService {
  constructor(
    private readonly repository = new PostgresProfessionalSubscriptionRepository(),
  ) {}

  async getEntitlementSnapshot(professionalId: string): Promise<ProfessionalEntitlementSnapshot> {
    return this.repository.getEntitlementSnapshot(professionalId);
  }

  async grant(
    professionalId: string,
    input: GrantProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.repository.grant(professionalId, input);
  }

  async extend(
    professionalId: string,
    input: ExtendProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.repository.extend(professionalId, input);
  }

  async revoke(professionalId: string): Promise<ProfessionalEntitlementSnapshot> {
    return this.repository.revoke(professionalId);
  }

  async reactivate(
    professionalId: string,
    input: ReactivateProfessionalSubscriptionInput,
  ): Promise<ProfessionalEntitlementSnapshot> {
    return this.repository.reactivate(professionalId, input);
  }
}
