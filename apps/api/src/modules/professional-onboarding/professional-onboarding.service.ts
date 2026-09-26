import { createSelfServiceProfessionalSchema,type CreateSelfServiceProfessionalInput } from "@contatocerto/shared";
import { PostgresProfessionalOnboardingRepository } from "./professional-onboarding.repository.js";
export class ProfessionalOnboardingService{constructor(private readonly repository=new PostgresProfessionalOnboardingRepository()){}
 async createProfile(accountId:string,input:CreateSelfServiceProfessionalInput){const outcome=await this.repository.create(accountId,createSelfServiceProfessionalSchema.parse(input));if(outcome.kind==="created")return outcome.professional;if(outcome.kind==="slug_conflict")throw new Error("professional_slug_conflict");if(outcome.kind==="identity_unverified")throw new Error("identity_unverified");throw new Error("professional_forbidden");}}
