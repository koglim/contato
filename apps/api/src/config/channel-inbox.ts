import { z } from "zod";

export const DEFAULT_CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS = 60;

export type ChannelInboxConfig = { processingLeaseSeconds: number };

const positiveInteger = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

export function readChannelInboxConfig(environment: NodeJS.ProcessEnv = process.env): ChannelInboxConfig {
  const parsed = positiveInteger.safeParse(
    environment.CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS
      ?? String(DEFAULT_CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS),
  );
  if (!parsed.success) throw new Error("Invalid channel inbox configuration: CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS");
  return { processingLeaseSeconds: parsed.data };
}
