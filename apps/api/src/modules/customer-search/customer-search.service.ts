import { randomUUID } from "node:crypto";
import type { CustomerSearchMessageResponse } from "@contatocerto/shared";
import type { ChannelLocationInput } from "@contatocerto/shared";
import { parseGlobalConversationCommand } from "../conversation-commands/conversation-command.parser.js";
import { mapGlobalConversationCommandOutcome } from "../global-conversation-commands/global-conversation-message.mapper.js";
import type { GlobalConversationCommandService } from "../global-conversation-commands/global-conversation-command.types.js";
import { mapSelectionCommandOutcome } from "../selection-message/selection-message.mapper.js";
import type { SelectionCommandService } from "../selection-command/selection-command.types.js";
import { CustomerPhoneIdentityCollisionError, type CustomerRepository } from "../customers/customer.repository.js";
import type {
  SearchConversationRecord,
  SearchConversationRepository,
  SearchConversationService,
} from "../search-conversations/search-conversation.types.js";
import type { CustomerLastLocation, CustomerLastLocationRepository } from "../customers/customer-last-location.repository.js";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import type { SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import type { SearchConversationConfig } from "../../config/search-conversation.js";
import { parseLocationConfirmation } from "../search-conversations/location-confirmation.parser.js";
import { extractExplicitLocation } from "../message-interpretation/message-interpretation.location.js";
import type { CustomerSearchRouteInput, CustomerSearchRouteOutcome, CustomerSearchRouter } from "./customer-search.types.js";

function isActiveConversationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "23505"
    && "constraint" in error
    && (error as { constraint?: unknown }).constraint === "search_conversations_one_active_per_customer_idx";
}

function searchRequestIdFrom(response: CustomerSearchMessageResponse): string | null {
  if (response.route === "selection" || response.route === "global_command") return null;
  const result = response.conversation.result;
  if ("matching" in result && result.matching) {
    return result.matching.search_request_id ?? null;
  }
  if ("orchestration" in result && (result as { orchestration?: { matching?: { search_request_id?: string } } }).orchestration?.matching) {
    return (result as { orchestration: { matching: { search_request_id: string } } }).orchestration.matching.search_request_id;
  }
  return null;
}

function presentedMatchIdsFrom(response: CustomerSearchMessageResponse): string[] {
  if (response.route === "selection" || response.route === "global_command") return [];
  const result = response.conversation.result;
  if (result.status !== "matched") return [];
  if ("matching" in result && result.matching) {
    return result.matching.matches.map((match) => match.match_id);
  }
  if ("orchestration" in result && (result as { orchestration?: { matching?: { matches: Array<{ match_id: string }> } } }).orchestration?.matching) {
    return (result as { orchestration: { matching: { matches: Array<{ match_id: string }> } } }).orchestration.matching.matches.map((match) => match.match_id);
  }
  return [];
}

export class DefaultCustomerSearchRouter implements CustomerSearchRouter {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly conversations: SearchConversationRepository,
    private readonly searchConversationService: SearchConversationService,
    private readonly selectionCommandService: SelectionCommandService,
    private readonly globalConversationCommandService: GlobalConversationCommandService,
    private readonly customerLastLocations?: CustomerLastLocationRepository,
    private readonly locationResolutionService?: LocationResolutionService,
    private readonly serviceResolutionRepository?: ServiceResolutionRepository,
    private readonly searchOrchestrationService?: SearchOrchestrationService,
    private readonly config: SearchConversationConfig = { ttlMinutes: 30, resumeTtlMinutes: 1440, processingLeaseSeconds: 60 },
  ) {}

  async route(input: CustomerSearchRouteInput): Promise<CustomerSearchRouteOutcome> {
    let customer;
    try {
      customer = await this.customers.findOrCreateByPhoneE164(input.phone_e164);
    } catch (error) {
      if (error instanceof CustomerPhoneIdentityCollisionError) {
        return { kind: "customer_phone_identity_collision" };
      }
      throw error;
    }

    const rawText = input.raw_text?.trim() ?? "";
    const globalCommand = rawText.length > 0 ? parseGlobalConversationCommand(rawText) : null;
    if (globalCommand) {
      const outcome = await this.globalConversationCommandService.execute({ customerId: customer.id, command: globalCommand });
      return {
        kind: "response",
        response: { customer_id: customer.id, route: "global_command", result: mapGlobalConversationCommandOutcome(outcome) },
        conversationId: null,
        searchRequestId: null,
        presentedMatchIds: [],
      };
    }

    if (input.selectionKey) {
      const recovered = await this.selectionCommandService.recoverSelection(customer.id, input.selectionKey);
      if (recovered) {
        return {
          kind: "response",
          response: { customer_id: customer.id, route: "selection", result: mapSelectionCommandOutcome(recovered) },
          conversationId: recovered.conversationId ?? null,
          searchRequestId: recovered.searchRequestId ?? null,
          presentedMatchIds: [],
        };
      }
    }

    await this.conversations.expireStaleForCustomer(customer.id);
    const activeConversation = await this.conversations.findActiveByCustomerId(customer.id);

    // Case F: Pin or message received while active in selection
    if (activeConversation?.pendingSlot === "selection") {
      if (input.location) {
        return {
          kind: "response",
          response: {
            customer_id: customer.id,
            route: "selection",
            result: {
              kind: "not_command",
            },
          },
          conversationId: activeConversation.id,
          searchRequestId: activeConversation.searchRequestId,
          presentedMatchIds: [],
        };
      }
      if (!input.selectionKey) return { kind: "selection_idempotency_key_required" };
      const outcome = await this.selectionCommandService.process({
        conversationId: activeConversation.id,
        customerId: customer.id,
        searchRequestId: activeConversation.searchRequestId,
        pendingSlot: "selection",
        rawText,
        lastMessageText: rawText,
        selectionKey: input.selectionKey,
        limit: activeConversation.limitValue,
      });
      if (outcome.kind === "show_more_requested" && outcome.hasMore && !(outcome.matches?.length)) {
        return { kind: "selection_show_more_pending" };
      }
      return {
        kind: "response",
        response: { customer_id: customer.id, route: "selection", result: mapSelectionCommandOutcome(outcome) },
        conversationId: activeConversation.id,
        searchRequestId: activeConversation.searchRequestId,
        presentedMatchIds: outcome.kind === "show_more_requested" ? (outcome.matches ?? []).map((match) => match.matchId) : [],
      };
    }

    if (activeConversation) {
      // Location confirmation pending slot
      if (activeConversation.pendingSlot === "location_confirmation") {
        return await this.handleLocationConfirmation(customer.id, activeConversation, input);
      }

      // Case A: Active in location, received pin
      if (activeConversation.pendingSlot === "location" && input.location) {
        return await this.handleLocationPinForActive(customer.id, activeConversation, input.location);
      }

      // Case B: Active in service, received pin (Second pin replacement)
      if (activeConversation.pendingSlot === "service" && input.location) {
        return await this.handleLocationPinWhileAwaitingService(customer.id, activeConversation, input.location, input);
      }

      // Standard continuation
      const outcome = await this.searchConversationService.continueConversation(activeConversation.id, {
        raw_text: input.raw_text,
        location: input.location,
      });
      if (outcome.kind === "conversation_processing" || outcome.kind === "service_unavailable") return outcome;
      if (outcome.kind !== "response") return { kind: "customer_conversation_conflict" };

      // Update memory on matched or no_matches search from text resolution or previous pin
      if (this.customerLastLocations) {
        const res = outcome.response.result;
        const matching = "matching" in res && res.matching ? res.matching : ("orchestration" in res && res.orchestration?.matching ? res.orchestration.matching : null);
        if (matching?.location && Number.isFinite(matching.location.latitude) && Number.isFinite(matching.location.longitude)) {
          const memorySource = activeConversation.locationSource ?? "text_resolved";
          await this.customerLastLocations.upsert({
            customerId: customer.id,
            latitude: matching.location.latitude,
            longitude: matching.location.longitude,
            city: matching.location.city ?? activeConversation.locationCity ?? null,
            state: matching.location.state ?? activeConversation.locationState ?? null,
            countryCode: activeConversation.countryCode,
            label: matching.location.city ? (matching.location.state ? `${matching.location.city} - ${matching.location.state}` : matching.location.city) : (activeConversation.locationText ?? "localização enviada"),
            source: memorySource,
          });
        }
      }

      const response: CustomerSearchMessageResponse = { customer_id: customer.id, route: "continued", conversation: outcome.response };
      return {
        kind: "response",
        response,
        conversationId: outcome.response.conversation_id,
        searchRequestId: searchRequestIdFrom(response),
        presentedMatchIds: presentedMatchIdsFrom(response),
      };
    }

    // Case B: Pin first, service second (no active conversation, location received)
    if (input.location) {
      return await this.handlePinFirst(customer.id, input.location, input);
    }

    // Text received with no active conversation: check remembered location
    const rememberedLocation = this.customerLastLocations
      ? await this.customerLastLocations.findByCustomerId(customer.id)
      : null;

    if (rememberedLocation && this.serviceResolutionRepository) {
      const serviceRes = await this.serviceResolutionRepository.resolve({ text: rawText });
      if (serviceRes.status === "resolved" && serviceRes.match) {
        const hasExplicitLocation = Boolean(extractExplicitLocation(rawText));
        if (!hasExplicitLocation) {
          // Case C: Service first with remembered location -> explicit confirmation required!
          return await this.startWithLocationConfirmation(customer.id, serviceRes.match.service.name, rememberedLocation, input);
        }
      }
    }

    // Normal start
    try {
      const outcome = await this.searchConversationService.start({
        raw_text: rawText,
        country_code: input.country_code,
        limit: input.limit,
      }, { customerId: customer.id });
      if (outcome.kind === "service_unavailable") return outcome;

      // Update memory on matched or no_matches search from text resolution (Case D)
      if (this.customerLastLocations) {
        const res = outcome.response.result as {
          orchestration?: { matching?: { location?: { latitude: number; longitude: number; city?: string | null; state?: string | null } | null } | null } | null;
          matching?: { location?: { latitude: number; longitude: number; city?: string | null; state?: string | null } | null } | null;
        };
        const matching = res.orchestration?.matching ?? res.matching;
        if (matching?.location && Number.isFinite(matching.location.latitude) && Number.isFinite(matching.location.longitude)) {
          await this.customerLastLocations.upsert({
            customerId: customer.id,
            latitude: matching.location.latitude,
            longitude: matching.location.longitude,
            city: matching.location.city ?? null,
            state: matching.location.state ?? null,
            countryCode: input.country_code,
            label: matching.location.city ? (matching.location.state ? `${matching.location.city} - ${matching.location.state}` : matching.location.city) : "localização enviada",
            source: "text_resolved",
          });
        }
      }

      const response: CustomerSearchMessageResponse = { customer_id: customer.id, route: "started", conversation: outcome.response };
      return {
        kind: "response",
        response,
        conversationId: outcome.response.conversation_id,
        searchRequestId: searchRequestIdFrom(response),
        presentedMatchIds: presentedMatchIdsFrom(response),
      };
    } catch (error) {
      if (isActiveConversationConflict(error)) return { kind: "customer_conversation_conflict" };
      throw error;
    }
  }

  private async handlePinFirst(
    customerId: string,
    location: ChannelLocationInput,
    input: CustomerSearchRouteInput,
  ): Promise<CustomerSearchRouteOutcome> {
    let label = "localização enviada";
    let city: string | null = null;
    let state: string | null = null;
    if (this.locationResolutionService) {
      try {
        const rev = await this.locationResolutionService.reverseGeocode({
          latitude: location.latitude,
          longitude: location.longitude,
        });
        if (rev?.city) {
          city = rev.city;
          state = rev.state;
          label = rev.state ? `${rev.city} - ${rev.state}` : rev.city;
        }
      } catch {
        // Fallback to default label
      }
    }

    if (this.customerLastLocations) {
      await this.customerLastLocations.upsert({
        customerId,
        latitude: location.latitude,
        longitude: location.longitude,
        city,
        state,
        countryCode: input.country_code,
        label,
        source: "whatsapp_native",
      });
    }

    const created = await this.conversations.createPending({
      customerId,
      pendingSlot: "service",
      originalRawText: label,
      serviceText: "",
      locationText: label,
      countryCode: input.country_code,
      limitValue: input.limit,
      ttlMinutes: this.config.ttlMinutes,
      pinLatitude: location.latitude,
      pinLongitude: location.longitude,
      pinName: location.name ?? null,
      locationSource: "whatsapp_native",
      locationCity: city,
      locationState: state,
    });

    return {
      kind: "response",
      response: {
        customer_id: customerId,
        route: "started",
        conversation: {
          conversation_id: created.id,
          conversation_status: "active",
          pending_slot: "service",
          result: {
            status: "needs_service",
            location_text: label,
            latitude: location.latitude,
            longitude: location.longitude,
            prompt: "Recebemos sua localização. Qual serviço você precisa?",
          },
        },
      },
      conversationId: created.id,
      searchRequestId: null,
      presentedMatchIds: [],
    };
  }

  private async startWithLocationConfirmation(
    customerId: string,
    serviceName: string,
    rememberedLocation: CustomerLastLocation,
    input: CustomerSearchRouteInput,
  ): Promise<CustomerSearchRouteOutcome> {
    const prompt = `É para ${rememberedLocation.label} novamente? Responda sim ou não. Se preferir, envie outra cidade ou sua localização pelo WhatsApp.`;
    const created = await this.conversations.createPending({
      customerId,
      pendingSlot: "location_confirmation",
      originalRawText: input.raw_text ?? serviceName,
      serviceText: serviceName,
      locationText: rememberedLocation.label,
      countryCode: input.country_code,
      limitValue: input.limit,
      ttlMinutes: this.config.ttlMinutes,
      pinLatitude: rememberedLocation.latitude,
      pinLongitude: rememberedLocation.longitude,
      locationSource: "memory_reuse",
      locationCity: rememberedLocation.city ?? null,
      locationState: rememberedLocation.state ?? null,
    });

    return {
      kind: "response",
      response: {
        customer_id: customerId,
        route: "started",
        conversation: {
          conversation_id: created.id,
          conversation_status: "active",
          pending_slot: "location_confirmation",
          result: {
            status: "needs_location_confirmation",
            service_name: serviceName,
            location_text: rememberedLocation.label,
            prompt,
          },
        },
      },
      conversationId: created.id,
      searchRequestId: null,
      presentedMatchIds: [],
    };
  }

  private async handleLocationPinForActive(
    customerId: string,
    activeConversation: SearchConversationRecord,
    location: ChannelLocationInput,
  ): Promise<CustomerSearchRouteOutcome> {
    const processingToken = randomUUID();
    const claimed = await this.conversations.claim(activeConversation.id, processingToken, this.config.processingLeaseSeconds);
    if (!claimed) return { kind: "conversation_processing" };

    try {
      let label = "localização enviada";
      let city: string | null = null;
      let state: string | null = null;
      if (this.locationResolutionService) {
        try {
          const rev = await this.locationResolutionService.reverseGeocode({
            latitude: location.latitude,
            longitude: location.longitude,
          });
          if (rev?.city) {
            city = rev.city;
            state = rev.state;
            label = rev.state ? `${rev.city} - ${rev.state}` : rev.city;
          }
        } catch {
          // Fallback
        }
      }

      if (this.customerLastLocations) {
        await this.customerLastLocations.upsert({
          customerId,
          latitude: location.latitude,
          longitude: location.longitude,
          city,
          state,
          countryCode: activeConversation.countryCode,
          label,
          source: "whatsapp_native",
        });
      }

      if (!this.searchOrchestrationService) {
        throw new Error("searchOrchestrationService is required to process location pin");
      }

      const orchestration = await this.searchOrchestrationService.orchestrate({
        raw_text: activeConversation.originalRawText,
        service_text: activeConversation.serviceText,
        location_text: label,
        country_code: activeConversation.countryCode,
        limit: activeConversation.limitValue,
        coordinates: {
          latitude: location.latitude,
          longitude: location.longitude,
          city: city ?? undefined,
          state: state ?? undefined,
          source: "whatsapp_native",
        },
      }, { customerId });

      if (orchestration.kind === "service_unavailable") {
        await this.conversations.releaseClaim(activeConversation.id, processingToken);
        return orchestration;
      }

      if (orchestration.response.status === "matched") {
        await this.conversations.moveToAwaitingSelection({
          id: activeConversation.id,
          processingToken,
          serviceText: activeConversation.serviceText,
          locationText: label,
          lastMessageText: label,
          searchRequestId: orchestration.response.matching.search_request_id,
          ttlMinutes: this.config.ttlMinutes,
          pinLatitude: location.latitude,
          pinLongitude: location.longitude,
          locationSource: "whatsapp_native",
          locationCity: city,
          locationState: state,
        });
        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "active",
            pending_slot: "selection",
            result: orchestration.response,
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: searchRequestIdFrom(response),
          presentedMatchIds: presentedMatchIdsFrom(response),
        };
      }

      if (orchestration.response.status === "no_matches") {
        await this.conversations.complete({
          id: activeConversation.id,
          processingToken,
          serviceText: activeConversation.serviceText,
          locationText: label,
          lastMessageText: label,
          searchRequestId: orchestration.response.matching.search_request_id,
          locationSnapshot: {
            latitude: location.latitude,
            longitude: location.longitude,
            name: location.name ?? null,
            source: "whatsapp_native",
            city: city ?? null,
            state: state ?? null,
          },
        });

        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "completed",
            pending_slot: null,
            result: orchestration.response,
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: searchRequestIdFrom(response),
          presentedMatchIds: presentedMatchIdsFrom(response),
        };
      }

      await this.conversations.releaseClaim(activeConversation.id, processingToken);
      return { kind: "service_unavailable" };
    } catch (error) {
      await this.conversations.releaseClaim(activeConversation.id, processingToken);
      throw error;
    }
  }

  private async handleLocationPinWhileAwaitingService(
    customerId: string,
    activeConversation: SearchConversationRecord,
    location: ChannelLocationInput,
    input: CustomerSearchRouteInput,
  ): Promise<CustomerSearchRouteOutcome> {
    const processingToken = randomUUID();
    const claimed = await this.conversations.claim(activeConversation.id, processingToken, this.config.processingLeaseSeconds);
    if (!claimed) return { kind: "conversation_processing" };

    try {
      let label = "localização enviada";
      let city: string | null = null;
      let state: string | null = null;
      if (this.locationResolutionService) {
        try {
          const rev = await this.locationResolutionService.reverseGeocode({
            latitude: location.latitude,
            longitude: location.longitude,
          });
          if (rev?.city) {
            city = rev.city;
            state = rev.state;
            label = rev.state ? `${rev.city} - ${rev.state}` : rev.city;
          }
        } catch {
          // Fallback safely
        }
      }

      if (this.customerLastLocations) {
        await this.customerLastLocations.upsert({
          customerId,
          latitude: location.latitude,
          longitude: location.longitude,
          city,
          state,
          countryCode: activeConversation.countryCode,
          label,
          source: "whatsapp_native",
        });
      }

      const rawText = input.raw_text?.trim();

      if (!rawText) {
        const updated = await this.conversations.updatePending({
          id: activeConversation.id,
          processingToken,
          pendingSlot: "service",
          serviceText: activeConversation.serviceText,
          locationText: label,
          lastMessageText: location.name ?? label,
          ttlMinutes: this.config.ttlMinutes,
          pinLatitude: location.latitude,
          pinLongitude: location.longitude,
          pinName: location.name ?? null,
          locationSource: "whatsapp_native",
          locationCity: city,
          locationState: state,
        });
        if (!updated) return { kind: "customer_conversation_conflict" };

        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "active",
            pending_slot: "service",
            result: {
              status: "needs_service",
              location_text: label,
              latitude: location.latitude,
              longitude: location.longitude,
              prompt: "Recebemos sua localização. Qual serviço você precisa?",
            },
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: null,
          presentedMatchIds: [],
        };
      }

      if (!this.searchOrchestrationService) {
        throw new Error("searchOrchestrationService is required to process search");
      }

      const orchestration = await this.searchOrchestrationService.orchestrate({
        raw_text: rawText,
        service_text: rawText,
        location_text: label,
        country_code: activeConversation.countryCode,
        limit: activeConversation.limitValue,
        coordinates: {
          latitude: location.latitude,
          longitude: location.longitude,
          city: city ?? undefined,
          state: state ?? undefined,
          source: "whatsapp_native",
        },
      }, { customerId });

      if (orchestration.kind === "service_unavailable") {
        await this.conversations.releaseClaim(activeConversation.id, processingToken);
        return orchestration;
      }

      if (orchestration.response.status === "needs_service") {
        await this.conversations.updatePending({
          id: activeConversation.id,
          processingToken,
          pendingSlot: "service",
          serviceText: "",
          locationText: label,
          lastMessageText: rawText,
          ttlMinutes: this.config.ttlMinutes,
          pinLatitude: location.latitude,
          pinLongitude: location.longitude,
          pinName: location.name ?? null,
          locationSource: "whatsapp_native",
          locationCity: city,
          locationState: state,
        });
        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "active",
            pending_slot: "service",
            result: orchestration.response,
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: null,
          presentedMatchIds: [],
        };
      }

      if (orchestration.response.status === "matched") {
        await this.conversations.moveToAwaitingSelection({
          id: activeConversation.id,
          processingToken,
          serviceText: orchestration.response.service_resolution.match?.service.name ?? rawText,
          locationText: label,
          lastMessageText: rawText,
          searchRequestId: orchestration.response.matching.search_request_id,
          ttlMinutes: this.config.ttlMinutes,
          pinLatitude: location.latitude,
          pinLongitude: location.longitude,
          pinName: location.name ?? null,
          locationSource: "whatsapp_native",
          locationCity: city,
          locationState: state,
        });
        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "active",
            pending_slot: "selection",
            result: orchestration.response,
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: searchRequestIdFrom(response),
          presentedMatchIds: presentedMatchIdsFrom(response),
        };
      }

      if (orchestration.response.status === "no_matches" && orchestration.response.matching) {
        await this.conversations.complete({
          id: activeConversation.id,
          processingToken,
          serviceText: orchestration.response.service_resolution.match?.service.name ?? rawText,
          locationText: label,
          lastMessageText: rawText,
          searchRequestId: orchestration.response.matching.search_request_id,
          locationSnapshot: {
            latitude: location.latitude,
            longitude: location.longitude,
            name: location.name ?? null,
            source: "whatsapp_native",
            city: city ?? null,
            state: state ?? null,
          },
        });

        const response: CustomerSearchMessageResponse = {
          customer_id: customerId,
          route: "continued",
          conversation: {
            conversation_id: activeConversation.id,
            conversation_status: "completed",
            pending_slot: null,
            result: orchestration.response,
          },
        };
        return {
          kind: "response",
          response,
          conversationId: activeConversation.id,
          searchRequestId: searchRequestIdFrom(response),
          presentedMatchIds: presentedMatchIdsFrom(response),
        };
      }

      await this.conversations.releaseClaim(activeConversation.id, processingToken);
      return { kind: "service_unavailable" };
    } catch (error) {
      await this.conversations.releaseClaim(activeConversation.id, processingToken).catch(() => {});
      throw error;
    }
  }

  private async handleLocationConfirmation(
    customerId: string,
    activeConversation: SearchConversationRecord,
    input: CustomerSearchRouteInput,
  ): Promise<CustomerSearchRouteOutcome> {
    if (input.location) {
      return await this.handleLocationPinForActive(customerId, activeConversation, input.location);
    }

    const rawText = input.raw_text?.trim() ?? "";
    const decision = parseLocationConfirmation(rawText);

    if (decision.kind === "confirm") {
      const processingToken = randomUUID();
      const claimed = await this.conversations.claim(activeConversation.id, processingToken, this.config.processingLeaseSeconds);
      if (!claimed) return { kind: "conversation_processing" };

      try {
        if (!this.searchOrchestrationService) {
          throw new Error("searchOrchestrationService is required for location confirmation");
        }

        const coordinates = (activeConversation.pinLatitude !== null && activeConversation.pinLatitude !== undefined && activeConversation.pinLongitude !== null && activeConversation.pinLongitude !== undefined)
          ? {
              latitude: activeConversation.pinLatitude,
              longitude: activeConversation.pinLongitude,
              source: "memory_reuse",
              city: activeConversation.locationCity ?? undefined,
              state: activeConversation.locationState ?? undefined,
            }
          : undefined;

        const orchestration = await this.searchOrchestrationService.orchestrate({
          raw_text: activeConversation.originalRawText,
          service_text: activeConversation.serviceText,
          location_text: activeConversation.locationText ?? "localização enviada",
          country_code: activeConversation.countryCode,
          limit: activeConversation.limitValue,
          coordinates,
        }, { customerId });

        if (orchestration.kind === "service_unavailable") {
          await this.conversations.releaseClaim(activeConversation.id, processingToken);
          return orchestration;
        }

        if (this.customerLastLocations && coordinates) {
          await this.customerLastLocations.upsert({
            customerId,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            city: activeConversation.locationCity ?? null,
            state: activeConversation.locationState ?? null,
            label: activeConversation.locationText ?? "localização enviada",
            source: "memory_reuse",
            countryCode: activeConversation.countryCode,
          });
        }

        if (orchestration.response.status === "matched") {
          await this.conversations.moveToAwaitingSelection({
            id: activeConversation.id,
            processingToken,
            serviceText: activeConversation.serviceText,
            locationText: activeConversation.locationText ?? "localização enviada",
            lastMessageText: rawText,
            searchRequestId: orchestration.response.matching.search_request_id,
            ttlMinutes: this.config.ttlMinutes,
            pinLatitude: coordinates?.latitude,
            pinLongitude: coordinates?.longitude,
            locationSource: "memory_reuse",
            locationCity: activeConversation.locationCity ?? null,
            locationState: activeConversation.locationState ?? null,
          });
          const response: CustomerSearchMessageResponse = {
            customer_id: customerId,
            route: "continued",
            conversation: {
              conversation_id: activeConversation.id,
              conversation_status: "active",
              pending_slot: "selection",
              result: orchestration.response,
            },
          };
          return {
            kind: "response",
            response,
            conversationId: activeConversation.id,
            searchRequestId: searchRequestIdFrom(response),
            presentedMatchIds: presentedMatchIdsFrom(response),
          };
        } else if (orchestration.response.status === "no_matches") {
          await this.conversations.complete({
            id: activeConversation.id,
            processingToken,
            serviceText: activeConversation.serviceText,
            locationText: activeConversation.locationText ?? "localização enviada",
            lastMessageText: rawText,
            searchRequestId: orchestration.response.matching.search_request_id,
            locationSnapshot: {
              latitude: activeConversation.pinLatitude ?? null,
              longitude: activeConversation.pinLongitude ?? null,
              name: activeConversation.pinName ?? null,
              source: "memory_reuse",
              city: activeConversation.locationCity ?? null,
              state: activeConversation.locationState ?? null,
            },
          });
          const response: CustomerSearchMessageResponse = {
            customer_id: customerId,
            route: "continued",
            conversation: {
              conversation_id: activeConversation.id,
              conversation_status: "completed",
              pending_slot: null,
              result: orchestration.response,
            },
          };
          return {
            kind: "response",
            response,
            conversationId: activeConversation.id,
            searchRequestId: searchRequestIdFrom(response),
            presentedMatchIds: presentedMatchIdsFrom(response),
          };
        }

        await this.conversations.releaseClaim(activeConversation.id, processingToken);
        return { kind: "service_unavailable" };
      } catch (error) {
        await this.conversations.releaseClaim(activeConversation.id, processingToken);
        throw error;
      }
    }

    if (decision.kind === "decline") {
      const processingToken = randomUUID();
      const claimed = await this.conversations.claim(activeConversation.id, processingToken, this.config.processingLeaseSeconds);
      if (!claimed) return { kind: "conversation_processing" };

      await this.conversations.updatePending({
        id: activeConversation.id,
        processingToken,
        pendingSlot: "location",
        serviceText: activeConversation.serviceText,
        locationText: null,
        lastMessageText: rawText,
        ttlMinutes: this.config.ttlMinutes,
        pinLatitude: null,
        pinLongitude: null,
        pinName: null,
        locationSource: null,
        locationCity: null,
        locationState: null,
      });

      const response: CustomerSearchMessageResponse = {
        customer_id: customerId,
        route: "continued",
        conversation: {
          conversation_id: activeConversation.id,
          conversation_status: "active",
          pending_slot: "location",
          result: {
            status: "needs_location",
            stage: "interpretation",
            reason: "missing_explicit_location",
            interpretation: {
              status: "needs_location",
              raw_text: activeConversation.originalRawText,
              service_text: activeConversation.serviceText,
              location_text: null,
              country_code: activeConversation.countryCode,
              interpretation: {
                service_strategy: "full_message",
                location_strategy: "none",
              },
            },
            orchestration: null,
          },
        },
      };
      return {
        kind: "response",
        response,
        conversationId: activeConversation.id,
        searchRequestId: null,
        presentedMatchIds: [],
      };
    }

    // Check if customer typed a new location text (override)
    if (this.locationResolutionService && rawText.length > 0) {
      const locationRes = await this.locationResolutionService.resolve({
        query: rawText,
        country_code: activeConversation.countryCode,
        limit: 5,
      });
      if (locationRes.status === "resolved" && locationRes.match) {
        const processingToken = randomUUID();
        const claimed = await this.conversations.claim(activeConversation.id, processingToken, this.config.processingLeaseSeconds);
        if (!claimed) return { kind: "conversation_processing" };

        try {
          if (!this.searchOrchestrationService) {
            throw new Error("searchOrchestrationService is required");
          }

          const overrideCoordinates = {
            latitude: locationRes.match.latitude,
            longitude: locationRes.match.longitude,
            city: locationRes.match.city ?? undefined,
            state: locationRes.match.state ?? undefined,
            neighborhood: locationRes.match.neighborhood ?? undefined,
            source: "text_resolved" as const,
          };

          const orchestration = await this.searchOrchestrationService.orchestrate({
            raw_text: activeConversation.originalRawText,
            service_text: activeConversation.serviceText,
            location_text: locationRes.match.label,
            country_code: activeConversation.countryCode,
            limit: activeConversation.limitValue,
            coordinates: overrideCoordinates,
          }, { customerId });

          if (orchestration.kind === "service_unavailable") {
            await this.conversations.releaseClaim(activeConversation.id, processingToken);
            return orchestration;
          }

          if (this.customerLastLocations) {
            await this.customerLastLocations.upsert({
              customerId,
              latitude: locationRes.match.latitude,
              longitude: locationRes.match.longitude,
              city: locationRes.match.city ?? null,
              state: locationRes.match.state ?? null,
              label: locationRes.match.label,
              source: "text_resolved",
              countryCode: activeConversation.countryCode,
            });
          }

          if (orchestration.response.status === "matched") {
            await this.conversations.moveToAwaitingSelection({
              id: activeConversation.id,
              processingToken,
              serviceText: activeConversation.serviceText,
              locationText: locationRes.match.label,
              lastMessageText: rawText,
              searchRequestId: orchestration.response.matching.search_request_id,
              ttlMinutes: this.config.ttlMinutes,
              pinLatitude: locationRes.match.latitude,
              pinLongitude: locationRes.match.longitude,
              locationSource: "text_resolved",
              locationCity: locationRes.match.city ?? null,
              locationState: locationRes.match.state ?? null,
            });
            const response: CustomerSearchMessageResponse = {
              customer_id: customerId,
              route: "continued",
              conversation: {
                conversation_id: activeConversation.id,
                conversation_status: "active",
                pending_slot: "selection",
                result: orchestration.response,
              },
            };
            return {
              kind: "response",
              response,
              conversationId: activeConversation.id,
              searchRequestId: searchRequestIdFrom(response),
              presentedMatchIds: presentedMatchIdsFrom(response),
            };
          } else if (orchestration.response.status === "no_matches") {
            await this.conversations.complete({
              id: activeConversation.id,
              processingToken,
              serviceText: activeConversation.serviceText,
              locationText: locationRes.match.label,
              lastMessageText: rawText,
              searchRequestId: orchestration.response.matching.search_request_id,
              locationSnapshot: {
                latitude: locationRes.match.latitude,
                longitude: locationRes.match.longitude,
                name: null,
                source: "text_resolved",
                city: locationRes.match.city ?? null,
                state: locationRes.match.state ?? null,
              },
            });
            const response: CustomerSearchMessageResponse = {
              customer_id: customerId,
              route: "continued",
              conversation: {
                conversation_id: activeConversation.id,
                conversation_status: "completed",
                pending_slot: null,
                result: orchestration.response,
              },
            };
            return {
              kind: "response",
              response,
              conversationId: activeConversation.id,
              searchRequestId: searchRequestIdFrom(response),
              presentedMatchIds: presentedMatchIdsFrom(response),
            };
          }

          await this.conversations.releaseClaim(activeConversation.id, processingToken);
          return { kind: "service_unavailable" };
        } catch (error) {
          await this.conversations.releaseClaim(activeConversation.id, processingToken);
          throw error;
        }
      }
    }

    // Ambiguous reply: safe re-prompt without mutating domain
    const prompt = `Por favor, responda se deseja buscar em ${activeConversation.locationText ?? "sua localização"} (sim/não) ou envie a nova cidade/localização.`;
    return {
      kind: "response",
      response: {
        customer_id: customerId,
        route: "continued",
        conversation: {
          conversation_id: activeConversation.id,
          conversation_status: "active",
          pending_slot: "location_confirmation",
          result: {
            status: "needs_location_confirmation",
            service_name: activeConversation.serviceText ?? undefined,
            location_text: activeConversation.locationText ?? "",
            prompt,
          },
        },
      },
      conversationId: activeConversation.id,
      searchRequestId: null,
      presentedMatchIds: [],
    };
  }
}
