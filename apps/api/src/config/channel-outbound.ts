import { z } from "zod";

export const DEFAULT_CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS = 60;

export type ChannelOutboundConfig = { processingLeaseSeconds: number };

const positiveInteger = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

export function readChannelOutboundConfig(environment: NodeJS.ProcessEnv = process.env): ChannelOutboundConfig {
  const parsed = positiveInteger.safeParse(
    environment.CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS
      ?? String(DEFAULT_CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS),
  );
  if (!parsed.success) throw new Error("Invalid channel outbound configuration: CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS");
  return { processingLeaseSeconds: parsed.data };
}
