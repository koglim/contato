import { z } from "zod";
import { updateProfessionalSchema } from "./professional.js";
import { updateProfessionalAvailabilitySchema } from "./professional-availability.js";
import { createProfessionalServiceSchema, updateProfessionalServiceSchema } from "./professional-service.js";
import { createServiceAreaSchema, updateServiceAreaSchema } from "./service-area.js";

// Separate self-service from the trusted internal administrative contract.
// Phone changes require verified identity and are not available in the demo.
export const updateSelfServiceProfileSchema = z.object({
  display_name: updateProfessionalSchema.shape.display_name,
  email: updateProfessionalSchema.shape.email,
  bio: updateProfessionalSchema.shape.bio,
  profile_image_url: updateProfessionalSchema.shape.profile_image_url,
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field must be provided");

const id = z.string().uuid();
export const dashboardMutationSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("POST"), payload: z.discriminatedUnion("action", [
    z.object({ action: z.literal("service"), data: createProfessionalServiceSchema }).strict(),
    z.object({ action: z.literal("area"), data: createServiceAreaSchema }).strict(),
  ]) }).strict(),
  z.object({ method: z.literal("PATCH"), payload: z.discriminatedUnion("action", [
    z.object({ action: z.literal("profile"), data: updateSelfServiceProfileSchema }).strict(),
    z.object({ action: z.literal("availability"), data: updateProfessionalAvailabilitySchema }).strict(),
    z.object({ action: z.literal("service"), id, data: updateProfessionalServiceSchema }).strict(),
    z.object({ action: z.literal("area"), id, data: updateServiceAreaSchema }).strict(),
  ]) }).strict(),
  z.object({ method: z.literal("DELETE"), payload: z.object({ action: z.literal("area"), id }).strict() }).strict(),
]);
