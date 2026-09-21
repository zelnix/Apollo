// Generated-equivalent wire types for the shared investigation case (backend/services/higgins/contracts.py, spec §4/§8).
export type Gate = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "app" | "file" | "device";
export type CaseStatus = "queued" | "investigating" | "waiting_device" | "waiting_user" | "retry_wait" | "partial" | "complete" | "failed" | "cancelled" | "expired";
export type CoverageStatus = "not_started" | "partial" | "examined" | "unavailable" | "out_of_scope";
export type Assessment = "concern_found" | "no_concern_found_within_scope" | "uncertain";
export type Attention = "none" | "review" | "action_needed" | "urgent";
export type Completion = "complete" | "partial" | "waiting_user";

export interface Coverage { status: CoverageStatus; unit: "bytes" | "characters" | "pages" | "items"; total: number | null; examined: number; examinedRanges: { start: number; end: number }[]; omittedRanges: { start: number; end: number; reason: string }[]; reason: string | null; materialGap: boolean }
export interface EvidenceItem { id: string; caseId: string; clientItemId: string; origin: "user_submission" | "device_observation" | "external_source" | "apollo_inference"; kind: string; parentId: string | null; availability: "available" | "unavailable" | "permission_required" | "purged"; mediaType: string | null; byteLength: number | null; coverage: Coverage; simulation: { kind: "preview_device"; label: string; fixtureId: string } | null; label: string; expiresAt: string }
export interface SourceReference { id: string; url: string; title: string; retrievedAt: string; retrieval: "fetched" | "search_result" | "unavailable"; authority: "official" | "independent" | "self_claimed" | "unknown"; authorityBasis: string }
export interface Finding { id: string; text: string; basis: "observation" | "user_report" | "inference"; confidence: "low" | "medium" | "high"; evidenceIds: string[]; sourceIds: string[] }
export interface Question { id: string; text: string; reasonNeeded: string; answerType: "text" | "yes_no" | "choice"; choices: string[] }
export interface ActionProposal { id: string; kind: "instruction" | "open_settings" | "request_permission" | "recheck" | "open_verified_source"; label: string; instruction: string; capabilityId: string | null; executionDescriptorId: string | null; requiresUserGesture: boolean; sourceIds: string[]; desiredField: string | null; desiredValue: boolean | string | null }
export interface HigginsResponse { revision: number; overview: string; explanationMarkdown: string; assessment: Assessment; attention: Attention; attentionReason: string | null; findings: Finding[]; uncertainties: string[]; scope: string; sourceIds: string[]; remainingEvidenceIds: string[]; actions: ActionProposal[]; recommendedActionId: string | null; question: Question | null; completion: Completion }
export interface Inventory { total: number; examined: number; partial: number; unavailable: number; purged: number }
export interface InvestigationCase { schemaVersion: 1; id: string; revision: number; gates: Gate[]; status: CaseStatus; createdAt: string; updatedAt: string; expiresAt: string; response: HigginsResponse | null; activeJobId: string | null; pendingDeviceRequestIds: string[]; inventory: Inventory; cleanupStatus: "not_due" | "pending" | "complete" | "failed" }
export interface Failure { code: string; message: string; retryable: boolean; retryAfterSeconds: number | null; missingEvidenceIds: string[] }
export interface Job { id: string; caseId: string; turnId: string; status: CaseStatus; startedAt: string | null; deadlineAt: string; retryAt: string | null; attempt: number; lastEventSequence: number; failure: Failure | null }
export type UnavailableReason = "not_implemented" | "os_restricted" | "hardware_absent" | "configuration_missing" | "entitlement_missing" | "adapter_failed";
export interface DeviceProfile { platform: "android" | "ios" | "windows" | "macos" | "web"; manufacturer: string | null; model: string | null; osVersion: string | null; formFactor: "phone" | "tablet" | "desktop" | "laptop" | "convertible" | "unknown"; locale: string; evidenceOrigin: "native" | "user_reported" | "browser"; capabilityIds: string[] }
export interface DeviceRequest { id: string; caseId: string; caseRevision: number; capabilityId: string; fields: string[]; reason: string; expiresAt: string }
export interface DeviceResult { requestId: string; caseRevision: number; capabilityId: string; status: "observed" | "unavailable" | "permission_required" | "denied" | "failed"; observedAt: string | null; values: Record<string, string | number | boolean | string[] | null>; simulation: { kind: "preview_device"; label: string; fixtureId: string } | null; unavailableReason: UnavailableReason | null }
export interface TurnCommit { turnId: string; caseId: string; inputRevision: number; committedRevision: number; question: string; answerToQuestionId: string | null; response: HigginsResponse; committedAt: string }
export interface Submission { clientItemId: string; kind: "text" | "url"; value: string; label?: string }
export interface CreateCase { gate: Gate | null; question: string; submissions: Submission[]; initialFindingRefs: string[]; initialFindings: string[]; deviceProfile: DeviceProfile | null }

export type InvestigationEvent =
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "progress"; payload: { phase: "ingest" | "observe" | "research" | "assess" | "respond"; message: string } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "device_request"; payload: DeviceRequest }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "question"; payload: Question }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "response"; payload: { response: HigginsResponse; sources: SourceReference[] } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "retry_scheduled"; payload: { retryAt: string; failure: Failure } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "completed"; payload: { turnId: string; responseRevision: number; providerComplete: true; completion: Completion; caseStatus: CaseStatus; cleanupStatus: string } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "partial"; payload: { responseRevision: number | null; reason: Failure; canContinue: boolean } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "failed"; payload: Failure }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "cancelled"; payload: { cleanupStatus: string } }
  | { sequence: number; jobId: string; caseId: string; revision: number; at: string; type: "expired"; payload: { missingEvidenceIds: string[]; cleanupStatus: string } };
