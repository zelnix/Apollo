export type AssessmentStatus = 'corroborated' | 'suspicious' | 'unresolved';

export interface InvestigationSource {
  source_id: string;
  label: string;
  url: string | null;
  status: 'supports' | 'contradicts' | 'inconclusive' | 'unavailable';
  detail: string;
  evidence_kind?: "submitted_content" | "external_verification" | "inference";
  checked_at?: string;
}

export interface InvestigationFinding {
  status: AssessmentStatus;
  title: string;
  detail: string;
  source_ids: string[];
  evidence_kind?: "submitted_content" | "external_verification" | "inference";
}

export interface InvestigationEntities {
  claimed_organisations: string[];
  sender_details: string[];
    sender_phone_numbers?: string[];
  callback_details: string[];
  links: string[];
  requested_actions: string[];
  transaction_claims: string[];
    mentioned_names?: string[];
    suspected_deception?: string[];
}

export interface HigginsAssessment {
  headline: string;
  next_action: string;
  exact_response: string;
  what_was_found: string[];
  why_it_matters: string[];
  could_not_establish: string[];
  action_label: string;
  action_kind: 'verify_officially' | 'avoid_and_delete' | 'check_account' | 'call_known_number' | 'review';
}

export interface InvestigationResult {
  assessment_id: string;
  risk: 'warning' | 'clear' | 'uncertain';
  entities: InvestigationEntities;
  findings: InvestigationFinding[];
  sources: InvestigationSource[];
  higgins: HigginsAssessment;
  technical_summary: string[];
  processing: {
    raw_retained_by_apollo: boolean;
    temporary_expiry_minutes: number;
    temporary_copy_policy?: string;
    provider?: string;
    model_used?: boolean;
    higgins_source?: "gemini" | "deterministic_fallback";
    model_attempts?: number;
    model_failures?: string[];
    fallback_used?: boolean;
    fallback_reasons?: string[];
    maximum_processing_retention_minutes?: number;
    provider_note: string;
  };
}

export function isInvestigationResult(value: unknown): value is InvestigationResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as InvestigationResult;
  return typeof item.assessment_id === 'string' && ['warning', 'clear', 'uncertain'].includes(item.risk) &&
    !!item.entities && Array.isArray(item.findings) && Array.isArray(item.sources) &&
    !!item.higgins && typeof item.higgins.next_action === 'string' && typeof item.higgins.exact_response === 'string' &&
    !!item.processing && item.processing.raw_retained_by_apollo === false;
}

/** Strip direct contact details/tokens before an assessment sentence enters Patrol. */
export function patrolSafeSummary(value: string): string {
  return value.slice(0, 400)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(?<!\w)(?:\+?\d[\s().-]*){9,14}(?!\w)/g, '[phone]')
    .replace(/\b\d{5,8}\b/g, '[code]')
    .replace(/https?:\/\/[^\s]+/gi, (raw) => { try { return new URL(raw).origin; } catch { return '[link]'; } });
}