import {
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
} from '@/lib/twilio-numbers'
import type { WorkflowDefinition, WorkflowImplementation } from './types'

const SYSTEM_OWNER = {
  kind: 'system',
  id: 'savingkc-operations',
  displayName: 'SavingKC Operations',
} as const

const ACQUISITIONS_OWNER = {
  kind: 'team',
  id: 'acquisitions',
  displayName: 'Acquisitions',
} as const

const DISPOSITIONS_OWNER = {
  kind: 'team',
  id: 'dispositions',
  displayName: 'Dispositions',
} as const

function implementation(
  sourceFiles: readonly string[],
  options: Partial<Omit<WorkflowImplementation, 'sourceFiles'>> = {},
): WorkflowImplementation {
  return {
    sourceFiles,
    execution: options.execution ?? 'route',
    mutatesData: options.mutatesData ?? true,
    approvalPolicy: options.approvalPolicy ?? 'automatic',
    ...(options.schedule ? { schedule: options.schedule } : {}),
  }
}

export const WORKFLOW_CATALOG: readonly WorkflowDefinition[] = [
  {
    id: 'acquisitions-seller-call-flow',
    name: 'Standard Seller Call Flow',
    description: 'The default acquisition path for main, business, and general seller numbers.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: 'all standard acquisition numbers' },
    actions: [
      { type: 'normalize_identity' },
      { type: 'ring_team', teamId: 'acquisitions', timeoutSeconds: 20 },
      { type: 'record_voicemail' },
      { type: 'create_next_action', actionType: 'call', title: 'Return missed seller call', dueOffsetMinutes: 5 },
    ],
    implementation: implementation(['/api/twiml-voice', '/api/ivr/handle-input', '/api/ivr/no-input', '/api/ivr/dial-result']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'google-ads-general-call-flow',
    name: 'Google Ads General Seller Line',
    description: 'Routes Search 2026 calls while preserving attribution and protected-number rules.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
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
    implementation: implementation(['/api/twiml-voice', '/api/ivr/google-ads', '/api/ivr/google-ads-agent-callback', '/api/ivr/google-ads-agent-callback-result']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'google-ads-tax-call-flow',
    name: 'Google Ads Property Tax Line',
    description: 'Routes property-tax campaign calls without exposing the attribution number to generic outbound tools.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER },
    actions: [
      { type: 'ring_owner', timeoutSeconds: 20 },
      { type: 'ring_team', teamId: 'acquisitions', timeoutSeconds: 20 },
      { type: 'record_voicemail' },
      { type: 'send_sms', templateId: 'property_tax_missed_call', consentRequired: true },
      { type: 'create_next_action', actionType: 'call', title: 'Return property-tax lead call', dueOffsetMinutes: 5 },
    ],
    protectedResources: [GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER],
    implementation: implementation(['/api/twiml-voice', '/api/ivr/google-ads', '/api/cron/google-ads-missed-calls']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'cold-call-callback-flow',
    name: 'Cold Call Callback Flow',
    description: 'Uses a press-1 seller path and sends a same-number follow-up when the caller provides no input.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: 'all cold-call callback numbers' },
    actions: [{ type: 'branch', condition: 'caller presses 1' }, { type: 'ring_team', teamId: 'acquisitions', timeoutSeconds: 20 }, { type: 'send_sms', templateId: 'cold_callback_no_input', consentRequired: true }],
    implementation: implementation(['/api/twiml-voice', '/api/ivr/handle-input', '/api/ivr/cold-no-input']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'ernest-direct-call-flow',
    name: 'Ernest Direct Company Line',
    description: 'Rings Ernest directly using the company identity and records the result.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: { kind: 'user', id: 'ernest', displayName: 'Ernest' },
    trigger: { type: 'inbound_call', phoneNumber: '+18166088588' },
    actions: [{ type: 'ring_owner', timeoutSeconds: 15 }, { type: 'record_voicemail' }],
    implementation: implementation(['/api/twiml-voice', '/api/ivr/dial-result']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'casey-direct-call-flow',
    name: 'Casey Direct Company Line',
    description: 'Rings Casey directly using the company identity and records the result.',
    category: 'phone_routing', status: 'active', health: 'healthy', owner: { kind: 'user', id: 'casey', displayName: 'Casey' },
    trigger: { type: 'inbound_call', phoneNumber: '+18167277667' },
    actions: [{ type: 'ring_owner', timeoutSeconds: 15 }, { type: 'record_voicemail' }],
    implementation: implementation(['/api/twiml-voice', '/api/ivr/dial-result']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'dispositions-inbound-call-flow',
    name: 'Dispositions Inbound Line',
    description: 'Tracks the dispositions number and exposes the current routing gap: it still enters the seller acquisition IVR.',
    category: 'phone_routing', status: 'active', health: 'warning', owner: DISPOSITIONS_OWNER,
    trigger: { type: 'inbound_call', phoneNumber: '+18166088858' },
    actions: [{ type: 'execute', label: 'Current: run standard acquisition seller IVR' }, { type: 'branch', condition: 'Replace with a dedicated buyer and disposition route' }],
    implementation: implementation(['/api/twiml-voice'], { approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'casey-legacy-call-flow',
    name: 'Casey Legacy Line',
    description: 'Documents the active legacy number and its current general-IVR behavior before migration or retirement.',
    category: 'phone_routing', status: 'active', health: 'warning', owner: { kind: 'user', id: 'casey', displayName: 'Casey' },
    trigger: { type: 'inbound_call', phoneNumber: '+18163754666' },
    actions: [{ type: 'execute', label: 'Current: run standard acquisition seller IVR' }, { type: 'branch', condition: 'Choose direct Casey routing or retire the number' }],
    implementation: implementation(['/api/twiml-voice'], { approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'inbound-sms-compliance',
    name: 'Inbound SMS Identity & Compliance',
    description: 'Handles STOP/START, resolves lead identity, records the exact to/from numbers, and updates conversation attention.',
    category: 'communication', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'inbound_sms', phoneScope: 'all_owned_numbers' },
    actions: [{ type: 'normalize_identity' }, { type: 'find_or_create_contact' }, { type: 'branch', condition: 'STOP, START, team number, Google Ads, or seller reply' }, { type: 'execute', label: 'Write activity and update conversation state' }],
    implementation: implementation(['/api/twilio-sms-webhook', 'src/lib/sms-opt-out.ts', 'src/lib/manifest-sync.ts']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'sms-sender-worker',
    name: 'Approved SMS Sender',
    description: 'Claims queued messages, checks consent and suppression, sends them, and records the provider outcome.',
    category: 'communication', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'manual', surface: '/api/workers/sms-sender' },
    actions: [{ type: 'execute', label: 'Claim queued SMS jobs' }, { type: 'branch', condition: 'Consent and opt-out checks pass' }, { type: 'execute', label: 'Send and persist Twilio result' }],
    implementation: implementation(['/api/workers/sms-sender', 'src/lib/safe-communications.ts'], { execution: 'worker' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'seller-form-intake',
    name: 'Website Seller Form',
    description: 'Resolves identity, creates the opportunity, assigns ownership, and establishes the first next action.',
    category: 'lead_intake', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'lead_form_submitted', formKey: 'seller-intake' },
    actions: [{ type: 'normalize_identity' }, { type: 'find_or_create_contact' }, { type: 'find_or_create_property' }, { type: 'create_opportunity', stage: 'new' }, { type: 'assign_owner', strategy: 'source_based' }, { type: 'create_next_action', actionType: 'call', title: 'Make first contact', dueOffsetMinutes: 5 }],
    implementation: implementation(['/api/leads', 'src/lib/operating-model/seller-intake.ts']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'ppc-lead-intake',
    name: 'Paid Search Lead Intake',
    description: 'Captures paid-search identity and attribution, creates the seller record, and starts first response.',
    category: 'lead_intake', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'webhook', event: 'PPC seller form submitted' },
    actions: [{ type: 'normalize_identity' }, { type: 'find_or_create_contact' }, { type: 'create_opportunity', stage: 'new' }, { type: 'notify_owner', urgency: 'urgent' }],
    implementation: implementation(['/api/leads/ppc', '/api/ppc/track', 'src/lib/ppc/lead-intelligence.ts']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'appointment-set',
    name: 'Appointment Set',
    description: 'Creates the calendar event, schedules reminders, and creates the required outcome action.',
    category: 'appointment', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'appointment_status_changed', toStatus: 'scheduled' },
    actions: [{ type: 'create_calendar_event' }, { type: 'send_sms', templateId: 'appointment_confirmation', consentRequired: true }, { type: 'create_next_action', actionType: 'review', title: 'Record appointment outcome', dueOffsetMinutes: 30 }],
    implementation: implementation(['/api/leads/create-appointment', '/api/workers/appointment-reminder', '/api/leads/appointment-outcome']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'appointment-ghost-protocol',
    name: 'Appointment Ghost Protocol',
    description: 'Escalates risk-based reminders and owner actions when an upcoming seller appointment goes cold.',
    category: 'appointment', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'record_changed', record: 'appointment', event: 'ghost risk reaches threshold' },
    actions: [{ type: 'branch', condition: 'ghost risk score is at least 50' }, { type: 'send_sms', templateId: 'appt_ghost_pattern_interrupt', consentRequired: true }, { type: 'notify_owner', urgency: 'urgent' }],
    implementation: implementation(['src/lib/ghost-protocol-appointment.ts', 'src/lib/ghost-risk-calculator.ts'], { execution: 'library' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'conversation-attention-state',
    name: 'Conversation Attention State',
    description: 'Derives Needs reply, Waiting on contact, or Resolved from meaningful communication outcomes.',
    category: 'communication', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'record_changed', record: 'communication', event: 'meaningful inbound or outbound outcome recorded' },
    actions: [{ type: 'execute', label: 'Reconcile communication outcome' }, { type: 'execute', label: 'Set one canonical attention state' }],
    implementation: implementation(['src/lib/operating-model/conversation-state.ts', '/api/conversations/thread-state'], { execution: 'library' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'stage-governance',
    name: 'Pipeline Stage Governance',
    description: 'Validates stage entry, advances valid records, and creates stage-driven next actions.',
    category: 'pipeline', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'opportunity_stage_changed', toStage: 'qualified' },
    actions: [{ type: 'execute', label: 'Validate required stage evidence' }, { type: 'execute', label: 'Advance canonical stage' }, { type: 'create_next_action', actionType: 'task', title: 'Complete stage next action', dueOffsetMinutes: 60 }],
    implementation: implementation(['/api/stage/validate', '/api/stage/advance', 'src/lib/pipeline-automation.ts']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'stage-timeout',
    name: 'Pipeline Stage Timeout',
    description: 'Finds records stalled beyond stage rules and creates the appropriate attention or next action.',
    category: 'pipeline', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'manual', surface: '/api/stage/timeout' },
    actions: [{ type: 'execute', label: 'Evaluate stage age' }, { type: 'create_next_action', actionType: 'review', title: 'Resolve stalled stage', dueOffsetMinutes: 0 }],
    implementation: implementation(['/api/stage/timeout', 'src/lib/stage-timeouts.ts']),
    version: 1, lastRunAt: null,
  },
  {
    id: 'disposition-broadcast',
    name: 'Disposition Buyer Broadcast',
    description: 'Builds the approved buyer audience, sends from the dispositions identity, and records delivery.',
    category: 'dispositions', status: 'active', health: 'healthy', owner: DISPOSITIONS_OWNER,
    trigger: { type: 'manual', surface: 'Dispositions > Broadcasts' },
    actions: [{ type: 'execute', label: 'Resolve buyer audience and exclusions' }, { type: 'execute', label: 'Require final sender review' }, { type: 'execute', label: 'Send and record delivery' }],
    implementation: implementation(['/api/broadcasts', '/api/broadcasts/send'], { approvalPolicy: 'user_confirmation' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'disposition-closeout',
    name: 'Transaction Funding & Closeout',
    description: 'Records confirmed funding, calculates economics, closes marketing and TC, and creates debrief and seller follow-up work.',
    category: 'dispositions', status: 'active', health: 'healthy', owner: DISPOSITIONS_OWNER,
    trigger: { type: 'record_changed', record: 'disposition deal', event: 'funding confirmed' },
    actions: [{ type: 'execute', label: 'Validate settlement and funding evidence' }, { type: 'execute', label: 'Record final economics' }, { type: 'execute', label: 'Close deal page and transaction coordination' }, { type: 'create_next_action', actionType: 'review', title: 'Complete post-close debrief', dueOffsetMinutes: 1440 }],
    implementation: implementation(['/api/dispo-deals/[id]/closeout', 'src/lib/dispo/closeout.ts'], { approvalPolicy: 'user_confirmation' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'post-close-debrief',
    name: 'Post-Close Debrief & Archive',
    description: 'Captures outcome quality, buyer performance, source quality, process lessons, then archives the completed transaction.',
    category: 'dispositions', status: 'active', health: 'healthy', owner: DISPOSITIONS_OWNER,
    trigger: { type: 'record_changed', record: 'disposition deal', event: 'closeout awaiting debrief' },
    actions: [{ type: 'execute', label: 'Capture scored debrief' }, { type: 'execute', label: 'Record process change' }, { type: 'execute', label: 'Complete and archive transaction' }],
    implementation: implementation(['/api/dispo-deals/[id]/closeout', 'src/lib/dispo/closeout.ts'], { approvalPolicy: 'user_confirmation' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'ppc-conversion-export',
    name: 'Google Ads Offline Conversion Export',
    description: 'Validates eligible CRM outcomes and exports approved qualified conversions to Google Ads.',
    category: 'reporting', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'scheduled', schedule: 'Every 15 minutes' },
    actions: [{ type: 'execute', label: 'Claim eligible outbox rows' }, { type: 'execute', label: 'Validate attribution and conversion policy' }, { type: 'execute', label: 'Upload and record provider result' }],
    implementation: implementation(['/api/workers/ppc-conversion-export', 'src/lib/ppc/conversion-exporter.ts'], { execution: 'worker', schedule: '*/15 * * * *', approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'google-ads-reporting-sync',
    name: 'Google Ads Reporting Sync',
    description: 'Refreshes campaign reporting data used by Marketing and CEO dashboards.',
    category: 'data_sync', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'scheduled', schedule: 'Every 10 minutes' },
    actions: [{ type: 'execute', label: 'Fetch authorized Google Ads reporting data' }, { type: 'execute', label: 'Normalize and persist reporting snapshot' }],
    implementation: implementation(['/api/cron/google-ads-reporting-sync'], { execution: 'worker', schedule: '*/10 * * * *', approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'google-ads-missed-call-reconciliation',
    name: 'Google Ads Missed-Call Reconciliation',
    description: 'Finds missed paid-search calls, repairs attention state, and escalates overdue return calls.',
    category: 'communication', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'scheduled', schedule: 'Every 5 minutes' },
    actions: [{ type: 'execute', label: 'Reconcile Twilio calls with CRM activity' }, { type: 'create_next_action', actionType: 'call', title: 'Return missed paid-search call', dueOffsetMinutes: 5 }],
    implementation: implementation(['/api/cron/google-ads-missed-calls', 'src/lib/google-ads-missed-call-reconciliation.ts'], { execution: 'worker', schedule: '*/5 * * * *' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'mojo-call-sync',
    name: 'Mojo Call Sync',
    description: 'Processes queued Mojo calling records into canonical leads, activities, outcomes, and attribution.',
    category: 'data_sync', status: 'active', health: 'healthy', owner: ACQUISITIONS_OWNER,
    trigger: { type: 'scheduled', schedule: 'Every 15 minutes' },
    actions: [{ type: 'execute', label: 'Claim queued Mojo records' }, { type: 'normalize_identity' }, { type: 'execute', label: 'Persist call outcome and lead state' }],
    implementation: implementation(['/api/cron/process-mojo-queue', '/api/mojo/sync', 'src/lib/lead-pipeline.ts'], { execution: 'worker', schedule: '*/15 * * * *' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'gmail-communication-sync',
    name: 'Gmail Communication Sync',
    description: 'Imports authorized email activity and attaches it to the correct CRM identity.',
    category: 'data_sync', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'scheduled', schedule: 'Daily at 8:15 AM Central' },
    actions: [{ type: 'execute', label: 'Read connected Gmail changes' }, { type: 'normalize_identity' }, { type: 'execute', label: 'Persist matching email activity' }],
    implementation: implementation(['/api/cron/sync-gmail'], { execution: 'worker', schedule: '15 13 * * *', approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'ari-briefing-sweep',
    name: 'ARI Briefing Sweep',
    description: 'Regenerates stale lead briefings so the next recommendation reflects current operating state.',
    category: 'ai', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'scheduled', schedule: 'Daily at 8:00 AM Central' },
    actions: [{ type: 'execute', label: 'Find stale briefing candidates' }, { type: 'execute', label: 'Generate grounded lead briefing' }, { type: 'execute', label: 'Persist briefing and timestamp' }],
    implementation: implementation(['/api/cron/sweep-briefings', '/api/ari/generate-briefing'], { execution: 'worker', schedule: '0 13 * * *', approvalPolicy: 'admin_only' }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'morning-operating-rhythm',
    name: 'Morning Operating Brief',
    description: 'Builds the agent start-of-day priorities from real tasks, conversations, pipeline state, and call queue.',
    category: 'operating_rhythm', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'manual', surface: 'ARI Insights' },
    actions: [{ type: 'execute', label: 'Assemble live operating context' }, { type: 'execute', label: 'Rank today’s work' }],
    implementation: implementation(['/api/rhythm/morning', '/api/ari/coaching'], { mutatesData: false }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'end-of-day-reconciliation',
    name: 'End-of-Day Reconciliation',
    description: 'Reconciles unfinished actions, communication attention, and daily agent commitments.',
    category: 'operating_rhythm', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'manual', surface: 'End-of-day review' },
    actions: [{ type: 'execute', label: 'Read today’s completed and unresolved work' }, { type: 'execute', label: 'Build reconciliation summary' }],
    implementation: implementation(['/api/rhythm/eod', '/api/eod'], { mutatesData: false }),
    version: 1, lastRunAt: null,
  },
  {
    id: 'weekly-operating-review',
    name: 'Weekly Operating Review',
    description: 'Produces the Sunday Game Plan and weekly health digest from recorded CRM outcomes.',
    category: 'operating_rhythm', status: 'active', health: 'healthy', owner: SYSTEM_OWNER,
    trigger: { type: 'manual', surface: 'Weekly review' },
    actions: [{ type: 'execute', label: 'Aggregate weekly scorecard' }, { type: 'execute', label: 'Identify bottlenecks and commitments' }, { type: 'execute', label: 'Save the reviewed plan' }],
    implementation: implementation(['/api/rhythm/weekly', '/api/rhythm/weekly/digest'], { approvalPolicy: 'user_confirmation' }),
    version: 1, lastRunAt: null,
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

  if (workflow.implementation.sourceFiles.length === 0) {
    issues.push({ severity: 'error', code: 'NO_IMPLEMENTATION', message: 'A workflow must identify its implementation source.' })
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
      issues.push({ severity: 'error', code: 'PROTECTED_PHONE_REQUIRED', message: 'Google Ads phone workflows must declare the inbound number as a protected resource.' })
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
    dispositions: 'Dispositions',
    data_sync: 'Data sync',
    reporting: 'Reporting',
    operating_rhythm: 'Operating rhythm',
    ai: 'AI / ARI',
  }[category]
}
