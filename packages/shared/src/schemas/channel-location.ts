import { z } from "zod";

export const channelLocationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(200).optional(),
}).strict();

export type ChannelLocationInput = z.infer<typeof channelLocationInputSchema>;
