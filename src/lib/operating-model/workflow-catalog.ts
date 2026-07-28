import {
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
} from '@/lib/twilio-numbers'
import type { WorkflowDefinition } from './types'

const SYSTEM_OWNER = {
  kind: 'system',
  id: 'savingkc-operations',
  displayName: 'SavingKC Operations',
} as const

export const WORKFLOW_CATALOG: readonly WorkflowDefinition[] = [
  {
    id: 'google-ads-general-call-flow',
    name: 'Google Ads General Seller Line',
    description: 'Routes inbound Search 2026 calls while preserving attribution and protected-number rules.',
    category: 'phone_routing',
    status: 'active',
    health: 'healthy',
    owner: SYSTEM_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: GOOGLE_ADS_TWILIO_NUMBER },
    actions: [
      { type: 'ring_owner', timeoutSeconds: 20 },
      { type: 'ring_team', teamId: 'acquisitions', timeoutSeconds: 20 },
      { type: 'record_voicemail' },
      { type: 'send_sms', templateId: 'missed_call_acknowledgement', consentRequired: true },
      { type: 'create_next_action', actionType: 'call', title: 'Return missed Google Ads call', dueOffsetMinutes: 5 },
      { type: 'notify_owner', urgency: 'urgent' },
    ],
    protectedResources: [GOOGLE_ADS_TWILIO_NUMBER],
    version: 1,
    lastRunAt: null,
  },
  {
    id: 'google-ads-tax-call-flow',
    name: 'Google Ads Property Tax Line',
    description: 'Routes property-tax campaign calls without exposing the number to generic outbound tools.',
    category: 'phone_routing',
    status: 'active',
    health: 'healthy',
    owner: SYSTEM_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER },
    actions: [
      { type: 'ring_owner', timeoutSeconds: 20 },
      { type: 'ring_team', teamId: 'acquisitions', timeoutSeconds: 20 },
      { type: 'record_voicemail' },
      { type: 'send_sms', templateId: 'property_tax_missed_call', consentRequired: true },
      { type: 'create_next_action', actionType: 'call', title: 'Return property-tax lead call', dueOffsetMinutes: 5 },
    ],
    protectedResources: [GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER],
    version: 1,
    lastRunAt: null,
  },
  {
    id: 'seller-form-intake',
    name: 'Website Seller Form',
    description: 'Resolves identity, creates the correct opportunity, assigns ownership, and starts first response.',
    category: 'lead_intake',
    status: 'draft',
    health: 'not_run',
    owner: SYSTEM_OWNER,
    trigger: { type: 'lead_form_submitted', formKey: 'seller-intake' },
    actions: [
      { type: 'normalize_identity' },
      { type: 'find_or_create_contact' },
      { type: 'find_or_create_property' },
      { type: 'create_opportunity', stage: 'new' },
      { type: 'assign_owner', strategy: 'source_based' },
      { type: 'send_sms', templateId: 'seller_form_acknowledgement', consentRequired: true },
      { type: 'create_next_action', actionType: 'call', title: 'Make first contact', dueOffsetMinutes: 5 },
      { type: 'notify_owner', urgency: 'urgent' },
    ],
    version: 1,
    lastRunAt: null,
  },
  {
    id: 'appointment-set',
    name: 'Appointment Set',
    description: 'Confirms the appointment, schedules reminders, and creates a required outcome action.',
    category: 'appointment',
    status: 'draft',
    health: 'not_run',
    owner: SYSTEM_OWNER,
    trigger: { type: 'appointment_status_changed', toStatus: 'scheduled' },
    actions: [
      { type: 'create_calendar_event' },
      { type: 'send_sms', templateId: 'appointment_confirmation', consentRequired: true },
      { type: 'send_email', templateId: 'appointment_confirmation' },
      { type: 'wait_until', relativeTo: 'appointment', offsetMinutes: -1440 },
      { type: 'send_sms', templateId: 'appointment_reminder_24h', consentRequired: true },
      { type: 'wait_until', relativeTo: 'appointment', offsetMinutes: -120 },
      { type: 'send_sms', templateId: 'appointment_reminder_2h', consentRequired: true },
      { type: 'create_next_action', actionType: 'review', title: 'Record appointment outcome', dueOffsetMinutes: 30 },
    ],
    version: 1,
    lastRunAt: null,
  },
] as const

export interface WorkflowValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []

  if (workflow.actions.length === 0) {
    issues.push({ severity: 'error', code: 'NO_ACTIONS', message: 'A workflow must contain at least one action.' })
  }

  for (const action of workflow.actions) {
    if (action.type === 'send_sms' && action.consentRequired !== true) {
      issues.push({ severity: 'error', code: 'SMS_CONSENT_REQUIRED', message: 'Every SMS action must enforce consent.' })
    }

    if ((action.type === 'ring_owner' || action.type === 'ring_team') && action.timeoutSeconds < 5) {
      issues.push({ severity: 'warning', code: 'RING_TIMEOUT_SHORT', message: 'Ring timeouts below five seconds are unlikely to be actionable.' })
    }
  }

  if (workflow.trigger.type === 'inbound_call') {
    const protectsTriggerNumber = workflow.protectedResources?.includes(workflow.trigger.phoneNumber)
    const isGoogleAdsNumber = [GOOGLE_ADS_TWILIO_NUMBER, GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER]
      .includes(workflow.trigger.phoneNumber as typeof GOOGLE_ADS_TWILIO_NUMBER)

    if (isGoogleAdsNumber && !protectsTriggerNumber) {
      issues.push({
        severity: 'error',
        code: 'PROTECTED_PHONE_REQUIRED',
        message: 'Google Ads phone workflows must declare the inbound number as a protected resource.',
      })
    }
  }

  return issues
}

export function workflowCategoryLabel(category: WorkflowDefinition['category']): string {
  return {
    phone_routing: 'Phone routing',
    lead_intake: 'Lead intake',
    appointment: 'Appointments',
    communication: 'Communications',
    pipeline: 'Pipeline',
    nurture: 'Nurture',
  }[category]
}
