export const MOJO_MINIMUM_MEANINGFUL_SECONDS: number

export type MojoQualificationStatus = 'eligible' | 'ineligible' | 'evidence_pending' | 'not_applicable'

export interface MojoQualificationAssessment {
  eligible: boolean
  status: MojoQualificationStatus
  reasons: string[]
  minimumSeconds: number
  durationSeconds: number
  sellerIntel: string[]
  negativeIntent: string[]
}

export interface MojoQualificationInput {
  outcome?: unknown
  disposition_outcome?: unknown
  durationSeconds?: unknown
  call_duration?: unknown
  notes?: unknown
  recordingUrl?: unknown
  recording_url?: unknown
  followUpAt?: unknown
  follow_up_date?: unknown
  hasAppointment?: unknown
  has_appointment?: unknown
  qualifiedByAgent?: unknown
  qualified_by_agent?: unknown
  qualificationOverrideReason?: unknown
  qualification_override_reason?: unknown
}

export function mojoSellerIntelSignals(notes: unknown): string[]
export function mojoNegativeIntentSignals(notes: unknown): string[]
export function assessMojoCallQualification(
  call: MojoQualificationInput,
  options?: { minimumSeconds?: number },
): MojoQualificationAssessment
