import { professionalAvailabilityResponseSchema, professionalEligibilitySchema, professionalLifecycleResponseSchema } from "@contatocerto/shared";
import { PostgresProfessionalEligibilityRepository } from "./professional-eligibility.repository.js";
export class ProfessionalEligibilityService{constructor(private readonly repository=new PostgresProfessionalEligibilityRepository()){}
 async get(professionalId:string){const value=await this.repository.find(professionalId);if(!value)throw new Error("professional_not_found");return professionalEligibilitySchema.parse(value);}
 async publish(accountId:string,professionalId:string){return professionalLifecycleResponseSchema.parse(await this.repository.publish(accountId,professionalId));}
 async unpublish(accountId:string,professionalId:string){return professionalLifecycleResponseSchema.parse(await this.repository.unpublish(accountId,professionalId));}
 async updateAvailability(accountId:string,professionalId:string,value:boolean){return professionalAvailabilityResponseSchema.parse(await this.repository.updateAvailability(accountId,professionalId,value));}}
