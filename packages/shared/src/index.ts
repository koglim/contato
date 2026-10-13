export { projectName } from "./constants/index.js";
export { healthResponseSchema } from "./schemas/health.js";
export {
  createProfessionalSchema,
  listProfessionalsQuerySchema,
  professionalResponseSchema,
  professionalStatusSchema,
  professionalManagementModeSchema,
  updateProfessionalSchema,
} from "./schemas/professional.js";
export {
  createProfessionalServiceSchema,
  listCatalogServicesQuerySchema,
  priceModeSchema,
  professionalServiceResponseSchema,
  serviceCatalogItemSchema,
  updateProfessionalServiceSchema,
} from "./schemas/professional-service.js";
export {
  createServiceAreaSchema,
  serviceAreaResponseSchema,
  updateServiceAreaSchema,
} from "./schemas/service-area.js";
export {
  professionalAvailabilityResponseSchema,
  updateProfessionalAvailabilitySchema,
} from "./schemas/professional-availability.js";
export { matchingSearchRequestSchema, matchingSearchResponseSchema } from "./schemas/matching.js";
export { serviceResolutionRequestSchema, serviceResolutionResponseSchema } from "./schemas/service-resolution.js";
export {
  locationResolutionCandidateSchema,
  locationResolutionRequestSchema,
  locationResolutionResponseSchema,
} from "./schemas/location-resolution.js";
export {
  searchOrchestrationCoordinatesSchema,
  searchOrchestrationRequestSchema,
  searchOrchestrationResponseSchema,
} from "./schemas/search-orchestration.js";
export {
  messageInterpretationRequestSchema,
  messageInterpretationResponseSchema,
} from "./schemas/message-interpretation.js";
export { messageSearchRequestSchema, messageSearchResponseSchema } from "./schemas/message-search.js";
export {
  continueSearchConversationParamsSchema,
  continueSearchConversationRequestSchema,
  continueSearchConversationResponseSchema,
  locationConfirmationResultSchema,
  nativeLocationNeedsServiceResultSchema,
  startSearchConversationRequestSchema,
  startSearchConversationResponseSchema,
} from "./schemas/search-conversation.js";
export {
  customerSearchMessageRequestSchema,
  customerSearchMessageResponseSchema,
} from "./schemas/customer-search.js";
export {
  phoneE164Schema,
  normalizeBrazilianMobilePhone,
  getPhoneIdentityAliases,
  arePhoneIdentitiesEquivalent,
  VALID_BRAZILIAN_DDDS,
} from "./schemas/phone.js";
export { selectionMessageContractSchema } from "./schemas/selection-message.js";
export { globalConversationMessageContractSchema } from "./schemas/global-conversation-message.js";
export {
  channelInboundMessageRequestSchema,
  channelInboundMessageResponseSchema,
  channelLocationInputSchema,
} from "./schemas/channel-inbox.js";
export {
  channelOutboundMessageClaimResponseSchema,
  channelOutboundMessageMutationResponseSchema,
  channelOutboundMessageParamsSchema,
  channelOutboundMessageStatusSchema,
  channelOutboundMessagePurposeSchema,
  markChannelOutboundMessageFailedSchema,
  markChannelOutboundMessageSentSchema,
  holdChannelOutboundMessageSchema,
  channelOutboundHoldResponseSchema,
} from "./schemas/channel-outbound.js";
export type { HealthResponse } from "./types/health.js";
export type {
  CreateProfessionalInput,
  ListProfessionalsQuery,
  ProfessionalResponse,
  ProfessionalStatus,
  ProfessionalManagementMode,
  UpdateProfessionalInput,
} from "./types/professional.js";
export type {
  CreateProfessionalServiceInput,
  ListCatalogServicesQuery,
  PriceMode,
  ProfessionalServiceResponse,
  ServiceCatalogItem,
  UpdateProfessionalServiceInput,
} from "./types/professional-service.js";
export type {
  CreateServiceAreaInput,
  ServiceAreaResponse,
  UpdateServiceAreaInput,
} from "./types/service-area.js";
export type {
  ProfessionalAvailabilityResponse,
  UpdateProfessionalAvailabilityInput,
} from "./types/professional-availability.js";
export type { MatchingSearchInput, MatchingSearchResponse } from "./types/matching.js";
export type { ServiceResolutionInput, ServiceResolutionResponse } from "./types/service-resolution.js";
export type {
  LocationResolutionCandidate,
  LocationResolutionInput,
  LocationResolutionResponse,
} from "./types/location-resolution.js";
export type {
  SearchOrchestrationInput,
  SearchOrchestrationResponse,
} from "./types/search-orchestration.js";
export type {
  MessageInterpretationInput,
  MessageInterpretationResponse,
} from "./types/message-interpretation.js";
export type { MessageSearchInput, MessageSearchResponse } from "./types/message-search.js";
export type {
  ContinueSearchConversationInput,
  ContinueSearchConversationResponse,
  StartSearchConversationInput,
  StartSearchConversationResponse,
} from "./types/search-conversation.js";
export type {
  CustomerSearchMessageInput,
  CustomerSearchMessageResponse,
} from "./types/customer-search.js";
export type {
  ChannelInboundMessageInput,
  ChannelInboundMessageResponse,
  ChannelLocationInput,
} from "./types/channel-inbox.js";
export type {
  ChannelOutboundMessageClaimResponse,
  ChannelOutboundMessageMutationResponse,
  ChannelOutboundMessageParams,
  ChannelOutboundMessageStatus,
  ChannelOutboundMessagePurpose,
  MarkChannelOutboundMessageFailedInput,
  MarkChannelOutboundMessageSentInput,
} from "./types/channel-outbound.js";
export type { SelectionMessageContract } from "./types/selection-message.js";
export type { GlobalConversationMessageContract } from "./types/global-conversation-message.js";
export { opportunityMessageSchema } from "./schemas/opportunity-message.js";
export { dashboardMutationSchema, updateSelfServiceProfileSchema } from "./schemas/dashboard-mutation.js";
export { channelOutboundQueueStatusSchema } from "./schemas/channel-outbound.js";
export type { ChannelOutboundQueueStatus } from "./types/channel-outbound.js";
export { contextualMessageSchema } from "./schemas/contextual-message.js";
export { inboxRecoveryResponseSchema, inboxDispositionSchema, inboxDispositionResponseSchema, inboxQueueStatusSchema } from "./schemas/inbox-recovery.js";
export type { InboxDisposition } from "./schemas/inbox-recovery.js";
export * from './schemas/channel-transport.js';
export { createSelfServiceProfessionalSchema, professionalDashboardAggregateSchema,
  professionalEligibilityReasonSchema, professionalEligibilitySchema,
  professionalLifecycleResponseSchema } from "./schemas/professional-onboarding.js";
export type { CreateSelfServiceProfessionalInput, ProfessionalDashboardAggregate,
  ProfessionalEligibility, ProfessionalEligibilityReason,
  ProfessionalLifecycleResponse } from "./types/professional-onboarding.js";
export {
  claimableProfessionalSchema,
  claimableProfessionalsResponseSchema,
  claimProfessionalInputSchema,
  claimProfessionalResponseSchema,
} from "./schemas/professional-claim.js";
export type {
  ClaimableProfessional,
  ClaimableProfessionalsResponse,
  ClaimProfessionalInput,
  ClaimProfessionalResponse,
} from "./types/professional-claim.js";
export {
  subscriptionPlanCodeSchema,
  subscriptionPlanEntitlementKeySchema,
  subscriptionPlanSchema,
  professionalEntitlementStateSchema,
  professionalEntitlementReasonSchema,
  professionalEntitlementSnapshotSchema,
  grantProfessionalSubscriptionSchema,
  extendProfessionalSubscriptionSchema,
  reactivateProfessionalSubscriptionSchema,
  professionalSubscriptionEventActionSchema,
  professionalSubscriptionEventSourceSchema,
  professionalSubscriptionEventSchema,
} from "./schemas/professional-subscription.js";
export type {
  SubscriptionPlanCode,
  SubscriptionPlanEntitlementKey,
  SubscriptionPlan,
  ProfessionalEntitlementState,
  ProfessionalEntitlementReason,
  ProfessionalEntitlementSnapshot,
  GrantProfessionalSubscriptionInput,
  ExtendProfessionalSubscriptionInput,
  ReactivateProfessionalSubscriptionInput,
  ProfessionalSubscriptionEventAction,
  ProfessionalSubscriptionEventSource,
  ProfessionalSubscriptionEvent,
} from "./types/professional-subscription.js";
export {
  contactCompletionStateSchema,
  contactCompletionActorRoleSchema,
  contactCompletionActionSchema,
  contactCompletionPublicCodeSchema,
  contactCompletionCommandSchema,
  contactCompletionRecordSchema,
  contactCompletionEventRecordSchema,
  contactCompletionMessageSchema,
} from "./schemas/contact-completion.js";
export type {
  ContactCompletionState,
  ContactCompletionActorRole,
  ContactCompletionAction,
  ContactCompletionCommand,
  ContactCompletionRecord,
  ContactCompletionEventRecord,
  ContactCompletionMessage,
} from "./schemas/contact-completion.js";
export {
  interactiveActionTypeSchema,
  interactiveActionTokenStatusSchema,
  interactiveOutboundActionSchema,
  interactiveOutboundPayloadSchema,
  interactiveTemplateAuthenticationPayloadSchema,
  interactiveActionResultSchema,
  INTERACTIVE_ACTION_TOKEN_TTL_DAYS,
} from "./schemas/interactive-action.js";
export type {
  InteractiveActionType,
  InteractiveActionTokenStatus,
  InteractiveOutboundAction,
  InteractiveOutboundPayload,
  InteractiveTemplateAuthenticationPayload,
  InteractiveActionResult,
} from "./schemas/interactive-action.js";


