import { z } from 'zod'

/**
 * The only accepted shape for a CRM-owned Email command. These schemas express
 * client input, not authority: the route resolves actor, workspace, membership,
 * ownership, suppression and CRM permission on the server.
 */
const uuid = z.string().uuid()
const revision = z.number().int().min(0)
const nonEmpty = z.string().trim().min(1)
const shortText = z.string().trim().min(1).max(500)
const longText = z.string().trim().min(1).max(10_000)
const hash = z.string().trim().min(8).max(512)
const isoDateTime = z.string().datetime({ offset: true })
const url = z.string().url().max(2_000)
const email = z.string().email().max(320)
const positiveInt = z.number().int().positive()
const nonNegativeInt = z.number().int().min(0)
const money = z.number().finite().min(0)
const emptyPayload = z.object({}).strict()

export const emailPrograms = ['seller_outreach', 'seller_nurture', 'buyer_marketing'] as const
export const emailProgramSchema = z.enum(emailPrograms)
export const emailRoles = ['owner', 'marketer', 'reviewer', 'acquisitions', 'reader'] as const
export const emailRoleSchema = z.enum(emailRoles)

const evidenceSchema = z.object({
  messageId: uuid.optional(),
  quote: z.string().trim().min(1).max(4_000).optional(),
  source: z.enum(['message', 'call_note', 'import', 'provider', 'human_assessment']),
}).strict()
const evidenceList = z.array(evidenceSchema).min(1).max(100)
const weekdaySchema = z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])

const hoursSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  weekdays: z.array(weekdaySchema).min(1).max(7),
  startLocal: z.string().regex(/^\d{2}:\d{2}$/),
  endLocal: z.string().regex(/^\d{2}:\d{2}$/),
}).strict()

const segmentConditionSchema = z.object({
  field: z.enum(['record_kind', 'county', 'city', 'stage', 'source', 'owner', 'last_contact_at', 'program_permission']),
  operator: z.enum(['equals', 'one_of', 'before', 'after', 'is_empty']),
  values: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
}).strict()
const segmentDefinitionSchema = z.object({ conditions: z.array(segmentConditionSchema).min(1).max(30) }).strict()

const mappingSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().min(1).max(200),
  property: z.string().trim().min(1).max(200).optional(),
  prospectId: z.string().trim().min(1).max(200).optional(),
  leadId: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(200).optional(),
  permissionDate: z.string().trim().min(1).max(200).optional(),
  permissionEvidence: z.string().trim().min(1).max(200).optional(),
  verificationStatus: z.string().trim().min(1).max(200).optional(),
  verificationDate: z.string().trim().min(1).max(200).optional(),
  verificationProvider: z.string().trim().min(1).max(200).optional(),
}).strict()

const campaignStepSchema = z.object({
  id: uuid,
  delayMinCalendarDays: z.number().int().min(0).max(10),
  delayMaxCalendarDays: z.number().int().min(0).max(10),
  targetCalendarDay: z.number().int().min(0).max(10),
  subject: z.string().trim().min(1).max(150),
  bodyTemplate: z.string().trim().min(1).max(10_000),
}).strict().superRefine((step, ctx) => {
  if (step.delayMinCalendarDays > step.delayMaxCalendarDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Minimum delay cannot exceed maximum delay', path: ['delayMinCalendarDays'] })
  }
  if (step.targetCalendarDay < step.delayMinCalendarDays || step.targetCalendarDay > step.delayMaxCalendarDays) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Target day must fall within the delay window', path: ['targetCalendarDay'] })
  }
})

const campaignDraftConfigSchema = z.object({
  audienceId: uuid,
  senderIds: z.array(uuid).min(1).max(10),
  playbookVersionId: uuid,
  mode: z.enum(['draft_only', 'bounded_auto']),
  copyMode: z.enum(['template', 'contextual_ai']),
  copySetId: uuid.optional(),
  draftGenerationBudget: money,
  steps: z.array(campaignStepSchema).min(1).max(4),
  timezone: z.string().trim().min(1).max(100),
  weekdays: z.array(weekdaySchema).min(1).max(7),
  startLocal: z.string().regex(/^\d{2}:\d{2}$/),
  endLocal: z.string().regex(/^\d{2}:\d{2}$/),
  dailyLimit: positiveInt,
  hourlyLimit: positiveInt,
  maxRecipients: positiveInt,
  dailyCostCap: money,
  totalCostCap: money,
  recontactDays: positiveInt,
  expiresAt: isoDateTime,
  replyActions: z.array(z.enum([
    'acknowledge_interest', 'reflect_with_label_mirror_or_paraphrase',
    'ask_one_question', 'answer_approved_faq', 'acknowledge_callback', 'confirm_verified_booking',
  ])).max(6),
  requiredPermissionBasis: nonEmpty.max(200),
}).strict().superRefine((config, ctx) => {
  const [first, ...followUps] = config.steps
  if (first && (first.delayMinCalendarDays !== 0 || first.delayMaxCalendarDays !== 0 || first.targetCalendarDay !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The first sequence step must send immediately', path: ['steps', 0] })
  }
  followUps.forEach((step, index) => {
    if (step.delayMinCalendarDays < 7 || step.delayMaxCalendarDays > 10 || step.targetCalendarDay !== 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Follow-ups must use the 7–10 day window with day 8 as target', path: ['steps', index + 1] })
    }
  })
})

const inboxQuerySchema = z.object({
  view: z.enum(['needs_action', 'needs_review', 'calls_appointments', 'ai_handling', 'waiting', 'closed_stopped', 'all']),
  ownerId: uuid.optional(),
  campaignId: uuid.optional(),
  search: z.string().trim().max(200).optional(),
  reasons: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  outcomes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  controllers: z.array(z.enum(['ai', 'human', 'none'])).max(3).optional(),
  unread: z.boolean().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
}).strict()

const qualificationPillarSchema = z.object({
  state: z.enum(['verified', 'unknown']),
  note: z.string().trim().max(2_000).optional(),
  evidenceIds: z.array(uuid).max(100),
}).strict()
const qualificationAssessmentSchema = z.object({
  personAuthority: z.object({
    state: z.enum(['confirmed', 'unknown']),
    note: z.string().trim().max(2_000).optional(),
    evidenceIds: z.array(uuid).max(100),
  }).strict(),
  propertyRef: z.string().trim().min(1).max(500),
  timeline: qualificationPillarSchema,
  condition: qualificationPillarSchema,
  motivation: qualificationPillarSchema,
  price: qualificationPillarSchema,
  whyWorthPursuing: z.string().trim().min(1).max(2_000),
}).strict()

const playbookPolicySchema = z.object({
  businessName: nonEmpty.max(200),
  assistantName: nonEmpty.max(200),
  humanDisclosure: nonEmpty.max(500),
  signature: nonEmpty.max(2_000),
  maxWords: z.number().int().min(1).max(120),
  maxAutoReplies7d: z.number().int().min(0).max(3),
  supportedLanguages: z.array(z.string().trim().min(2).max(20)).min(1).max(20),
  allowedActions: z.array(z.enum([
    'acknowledge_interest', 'reflect_with_label_mirror_or_paraphrase',
    'ask_one_question', 'answer_approved_faq', 'acknowledge_callback', 'confirm_verified_booking',
  ])).max(6),
}).strict()

const rateCardSchema = z.object({
  provider: nonEmpty.max(100),
  unit: nonEmpty.max(100),
  amount: money,
  asOf: isoDateTime,
  source: z.enum(['provider_reported', 'owner_reported', 'estimate']),
}).strict()

const command = <T extends string, P extends z.ZodTypeAny>(commandName: T, payload: P) =>
  z.object({
    command: z.literal(commandName),
    idempotencyKey: uuid,
    entityId: uuid.optional(),
    expectedRevision: revision.optional(),
    payload,
  }).strict()

export const emailCommandSchema = z.discriminatedUnion('command', [
  command('SET-BUSINESS', z.object({
    name: nonEmpty.max(200), address: nonEmpty.max(1_000), primaryDomain: nonEmpty.max(255),
    timezone: nonEmpty.max(100), programs: z.array(emailProgramSchema).min(1).max(3),
    contact: nonEmpty.max(500), privacyUrl: url,
  }).strict()),
  command('SVC-CONNECT', emptyPayload),
  command('SVC-SIGNUP', emptyPayload),
  command('SVC-CHECK', z.object({ connectionId: uuid }).strict()),
  command('SVC-DISCONNECT', z.object({ connectionId: uuid, reason: shortText, confirmedAffectedHash: hash }).strict()),
  command('SET-TEAM', z.object({
    reviewerId: uuid, acquisitionOwnerId: uuid, backupId: uuid, hours: hoursSchema,
    sla: z.object({ urgentMinutes: positiveInt, ordinaryMinutes: positiveInt }).strict(),
    calendarMode: z.enum(['manual', 'connected']),
  }).strict()),
  command('SET-AUTOMATION', z.object({
    mode: z.enum(['draft_only', 'bounded_auto']), playbookVersionId: uuid,
    maxReplies: z.number().int().min(0).max(3), language: z.string().trim().min(2).max(20),
    allowedActions: playbookPolicySchema.shape.allowedActions,
  }).strict()),
  command('SET-BUDGET', z.object({
    dailyCap: money, totalCap: money, rateCards: z.array(rateCardSchema).max(30), costTerms: z.string().trim().max(4_000),
  }).strict()),
  command('SET-READINESS', z.object({
    kind: z.enum(['simulation', 'provider']), configHash: hash,
    testRecipientIds: z.array(uuid).min(1).max(20), maximumTestSends: z.number().int().min(0).max(20),
  }).strict()),
  command('SET-FINISH', z.object({ readinessRunId: uuid, configHash: hash }).strict()),
  command('SET-ENABLE', z.object({ readinessRunId: uuid, configHash: hash }).strict()),
  command('SET-PAUSE', z.object({ reason: shortText }).strict()),

  command('AUD-CREATE', z.object({
    name: nonEmpty.max(200), program: emailProgramSchema,
    kind: z.enum(['prospects', 'leads', 'buyers']), segmentDefinition: segmentDefinitionSchema.optional(),
  }).strict()),
  command('AUD-UPLOAD', z.object({ audienceId: uuid, fileName: nonEmpty.max(255), size: positiveInt.max(50_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict()),
  command('AUD-MAP', z.object({
    importId: uuid, mapping: mappingSchema, sourceEvidence: evidenceList,
    permissionEvidence: evidenceList, verificationMapping: mappingSchema.partial().strict().optional(),
  }).strict()),
  command('AUD-REFRESH', z.object({ audienceId: uuid, segmentDefinition: segmentDefinitionSchema }).strict()),
  command('AUD-RESOLVE', z.object({
    rowId: uuid, partyId: uuid.optional(), leadId: uuid.optional(), propertyRef: nonEmpty.max(500).optional(),
    resolution: z.enum(['link_existing', 'mark_unresolved', 'exclude']), relationship: z.enum(['owner','representative','heir','relative']).optional(), evidence: evidenceList,
  }).strict()),
  command('AUD-VERIFY', z.object({ selectionToken: hash, method: z.enum(['provider', 'import']), estimateHash: hash }).strict()),
  command('AUD-EXCLUDE', z.object({ rowIds: z.array(uuid).min(1).max(500), excluded: z.boolean(), reason: shortText }).strict()),
  command('AUD-PREPARE', z.object({ audienceId: uuid }).strict()),
  command('AUD-ARCHIVE', z.object({ audienceId: uuid, reason: shortText }).strict()),

  command('CAM-CREATE', z.object({ name: nonEmpty.max(200), program: emailProgramSchema, audienceId: uuid.optional() }).strict()),
  command('CAM-SAVE', z.object({ draftConfig: campaignDraftConfigSchema }).strict()),
  command('CAM-PREVIEW', z.object({ recipientRowId: uuid, draftHash: hash }).strict()),
  command('CAM-TEST', z.object({ senderId: uuid, testRecipientId: uuid, draftHash: hash }).strict()),
  command('CAM-LAUNCH', z.object({
    draftHash: hash, audienceHash: hash, readinessRunId: uuid, startAt: isoDateTime.optional(),
    approvedMaxRecipients: positiveInt, estimateHash: hash,
  }).strict()),
  command('CAM-PAUSE', z.object({ reason: shortText }).strict()),
  command('CAM-RESUME', z.object({ readinessRunId: uuid, resumePreviewHash: hash }).strict()),
  command('CAM-REVISE', z.object({ campaignId: uuid }).strict()),
  command('CAM-DUPLICATE', z.object({ campaignId: uuid, newName: nonEmpty.max(200) }).strict()),
  command('CAM-STOP-RECIPIENT', z.object({ enrollmentId: uuid, reason: shortText }).strict()),
  command('CAM-ARCHIVE', z.object({ campaignId: uuid, reason: shortText }).strict()),

  command('THR-READ', z.object({ threadId: uuid, lastReadMessageId: uuid.optional(), unread: z.boolean() }).strict()),
  command('THR-TAKEOVER', z.object({ threadId: uuid, expectedControllerRevision: revision }).strict()),
  command('THR-TRANSFER', z.object({ threadId: uuid, newOwnerId: uuid, reason: shortText, expectedControllerRevision: revision }).strict()),
  command('THR-RELEASE', z.object({ threadId: uuid, playbookVersionId: uuid, reviewedContentRevision: revision }).strict()),
  command('THR-DRAFT', z.object({ threadId: uuid, body: longText, contentRevision: revision, controllerRevision: revision }).strict()),
  command('THR-SEND', z.object({ draftId: uuid, bodyHash: hash, contentRevision: revision, controllerRevision: revision }).strict()),
  command('THR-REGENERATE', z.object({ threadId: uuid, contentRevision: revision, controllerRevision: revision, instruction: z.string().trim().min(1).max(500).optional() }).strict()),
  command('THR-SCHEDULE', z.object({ threadId: uuid, contentRevision: revision, controllerRevision: revision, title: nonEmpty.max(200), note: z.string().trim().max(2000), kind: z.enum(['follow_up', 'callback', 'appointment', 'task', 'send_offer']), assigneeId: uuid, startAt: isoDateTime, timezone: z.literal('America/Chicago') }).strict()),
  command('THR-NOTE', z.object({ threadId: uuid, body: shortText }).strict()),
  command('THR-SNOOZE', z.object({ threadId: uuid, until: isoDateTime.optional() }).strict()),
  command('THR-CLOSE', z.object({ threadId: uuid, closed: z.boolean(), reason: shortText }).strict()),
  command('THR-TAG', z.object({ threadId: uuid, tags: z.array(z.string().trim().min(1).max(64)).max(20) }).strict()),
  command('THR-LINK', z.object({ threadId: uuid, partyId: uuid, propertyRef: nonEmpty.max(500).optional(), leadId: uuid.optional(), evidence: evidenceList }).strict()),
  command('THR-HANDOFF', z.object({
    threadId: uuid, ownerId: uuid, backupId: uuid, reason: shortText,
    positiveSellerInterest: z.boolean().default(false),
    requestedContact: z.object({
      phone: z.string().trim().min(3).max(50).optional(),
      requestedTimeText: z.string().trim().min(1).max(500).optional(),
    }).strict(),
    factEvidence: evidenceList,
  }).strict()),
  command('REV-APPROVE', z.object({
    reviewId: uuid, draftId: uuid, bodyHash: hash, contentRevision: revision,
    controllerRevision: revision, policyHash: hash,
  }).strict()),
  command('REV-REJECT', z.object({ reviewId: uuid, reason: shortText }).strict()),
  command('REV-ASSIGN', z.object({ reviewId: uuid, assigneeId: uuid, dueAt: isoDateTime.optional() }).strict()),
  command('REV-RESOLVE', z.object({
    reviewId: uuid, resolution: z.enum(['no_reply_needed', 'identity_fixed', 'handled_elsewhere']), note: shortText,
  }).strict()),
  command('INB-SAVEVIEW', z.object({
    viewId: uuid.optional(), name: nonEmpty.max(100), queryVersion: z.literal(1),
    query: inboxQuerySchema, expectedRevision: revision.optional(),
  }).strict()),
  command('INB-DELETEVIEW', z.object({ viewId: uuid, expectedRevision: revision }).strict()),

  command('HAN-ACCEPT', z.object({ handoffId: uuid }).strict()),
  command('HAN-REASSIGN', z.object({ handoffId: uuid, newOwnerId: uuid, backupId: uuid, reason: shortText,
    expectedCrmOwner: z.string().nullable(), contentRevision: revision, controllerRevision: revision }).strict()),
  command('HAN-RESOLVE', z.object({ handoffId: uuid, ownerId: uuid, backupId: uuid, reason: shortText,
    positiveSellerInterest: z.boolean(), requestedContact: z.object({ phone: z.string().trim().min(1).max(100).optional(), requestedTimeText: shortText.optional() }).strict(),
    factEvidence: evidenceList, contentRevision: revision, controllerRevision: revision }).strict()),
  command('HAN-SCHEDULE', z.object({
    title: nonEmpty.max(200).optional(), note: z.string().trim().max(2000).optional(),
    handoffId: uuid, mode: z.enum(['task', 'calendar']), startAt: isoDateTime,
    timezone: nonEmpty.max(100), phoneEvidence: evidenceList.optional(), slotToken: hash.optional(),
    contentRevision: revision.optional(),
  }).strict()),
  command('HAN-OUTCOME', z.object({
    handoffId: uuid, outcome: z.enum(['conversation_complete', 'follow_up', 'no_contact', 'not_qualified', 'controlled_test_complete']),
    note: shortText, nextAction: z.string().trim().min(1).max(200).optional(), nextDueAt: isoDateTime.optional(), completedAt: isoDateTime.optional(),
    contentRevision: revision.optional(),
  }).strict()),
  command('HAN-QUALIFY', z.object({
    handoffId: uuid, leadId: uuid, leadRevision: revision, assessment: qualificationAssessmentSchema,
    nextAction: nonEmpty.max(2_000), evidenceIds: z.array(uuid).min(1).max(100),
  }).strict()),
  command('HAN-RETURN', z.object({ handoffId: uuid, question: shortText, reviewerId: uuid }).strict()),

  command('PB-SAVE', z.object({ name: nonEmpty.max(200), program: emailProgramSchema, policy: playbookPolicySchema, prompt: longText }).strict()),
  command('PB-SIMULATE', z.object({ playbookDraftHash: hash, fixtureSetId: uuid, modelId: nonEmpty.max(200) }).strict()),
  command('PB-PUBLISH', z.object({ draftHash: hash, evalRunId: uuid, modelRateVersion: nonEmpty.max(200) }).strict()),
  command('DOM-ADD', z.object({ domain: nonEmpty.max(255), connectionId: uuid, brandUrl: url }).strict()),
  command('DOM-VERIFY', z.object({ domainId: uuid }).strict()),
  command('DOM-PAUSE', z.object({ domainId: uuid, paused: z.boolean(), reason: shortText, readinessRunId: uuid.optional() }).strict()),
  command('SND-SAVE', z.object({
    senderId: uuid.optional(), domainId: uuid, fromName: nonEmpty.max(200),
    localPart: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._+-]+$/),
    signature: z.string().trim().max(2_000), hourlyLimit: positiveInt, dailyLimit: positiveInt,
    state: z.enum(['active', 'paused', 'retired']),
  }).strict()),
  command('SND-TEST', z.object({ senderId: uuid, testRecipientId: uuid, maximumTestSends: z.literal(1).default(1) }).strict()),
  command('SET-ROLES', z.object({ authUserId: uuid, roles: z.array(emailRoleSchema).min(1).max(5), active: z.boolean(), affectedWorkHash: hash }).strict()),
  command('SET-RETENTION', z.object({
    periods: z.object({
      rawImportsDays: positiveInt, rawMailDays: positiveInt, normalizedThreadsDays: positiveInt, auditQualificationDays: positiveInt,
    }).strict(),
    legalHoldPolicy: nonEmpty.max(2_000), activatePurge: z.literal(false).default(false), previewHash: hash.optional(),
  }).strict()),
  command('SUP-ADD', z.object({
    addressIds: z.array(uuid).min(1).max(500).optional(), partyIds: z.array(uuid).min(1).max(500).optional(),
    scope: z.enum(['all_marketing', 'program', 'campaign']), program: emailProgramSchema.optional(),
    reason: z.enum(['unsubscribe', 'complaint', 'hard_bounce', 'possible_opt_out', 'manual', 'imported', 'wrong_person']),
    evidenceIds: z.array(uuid).max(100).optional(), importId: uuid.optional(),
  }).strict().superRefine((input, ctx) => {
    if (!input.addressIds && !input.partyIds && !input.importId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A suppression target is required' })
    if (input.scope === 'program' && !input.program) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Program scope requires a program', path: ['program'] })
    if (input.scope !== 'program' && input.program) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Program is only accepted for program scope', path: ['program'] })
  })),
  command('SUP-RELEASE', z.object({ suppressionId: uuid, evidence: evidenceList, reason: shortText, confirmedScopeHash: hash }).strict()),
  command('OPS-REPLAY', z.object({ jobId: uuid, expectedFailureCode: nonEmpty.max(200), reason: shortText }).strict()),
  command('OPS-RECONCILE', z.object({ intentId: uuid, providerEvidence: evidenceList.optional() }).strict()),
  command('OPS-ACK', z.object({ incidentKey: nonEmpty.max(512), note: shortText }).strict()),

  command('RPT-EXPORT', z.object({ queryHash: hash, format: z.literal('csv') }).strict()),
  command('PUB-UNSUBSCRIBE', emptyPayload),
  command('PUB-PREFERENCE', z.object({ program: emailProgramSchema }).strict()),
  command('COP-GENERATE', z.object({
    campaignId: uuid, draftRevision: revision, snapshotId: uuid,
    copyMode: z.enum(['template', 'contextual_ai']), policyHash: hash, generationCap: money,
  }).strict()),
  command('COP-REVIEW', z.object({
    copySetId: uuid, contentHash: hash, sampleRowIds: z.array(uuid).min(1).max(100), resolvedFlagIds: z.array(uuid).max(1_000),
  }).strict()),
  command('NTF-TEST', z.object({ channel: z.literal('push'), subscriptionRef: uuid }).strict()),
  command('NTF-ACK', z.object({ eventId: uuid, eventRevision: revision }).strict()),
  command('SCH-POLICY', z.object({
    enabled: z.boolean(), agentCalendars: z.array(uuid).min(1).max(100), hours: hoursSchema,
    durationMinutes: positiveInt.max(480), bufferMinutes: nonNegativeInt.max(240),
    maxDailyBookings: positiveInt.max(100), alertCheckIds: z.array(uuid).min(1).max(100),
  }).strict()),
  command('SCH-RESCHEDULE', z.object({
    handoffId: uuid, eventId: uuid, eventRevision: revision, newSlotToken: hash, requestEvidenceIds: z.array(uuid).min(1).max(100),
  }).strict()),
  command('SCH-CANCEL', z.object({
    handoffId: uuid, eventId: uuid, eventRevision: revision, reason: shortText, evidenceIds: z.array(uuid).min(1).max(100),
  }).strict()),
  command('TEL-SAVE', z.object({
    existingProviderNumberId: uuid, purpose: z.literal('email_response'),
    routingPolicy: z.enum(['primary_then_backup', 'voicemail_after_hours']), hours: hoursSchema,
    voicemail: z.enum(['enabled', 'disabled']), callerIdPolicy: z.enum(['stable_number', 'no_outbound_calls']),
  }).strict()),
  command('TEL-TEST', z.object({ lineId: uuid, expectedPrimaryId: uuid, expectedBackupId: uuid }).strict()),
])

export type EmailCommand = z.infer<typeof emailCommandSchema>
export type EmailCommandId = EmailCommand['command']
export const EMAIL_COMMAND_IDS = emailCommandSchema.options.map((schema) => schema.shape.command.value) as readonly EmailCommandId[]

export const emailCommandSuccessSchema = z.object({
  ok: z.literal(true), requestId: uuid, entityId: uuid, revision,
  state: nonEmpty.max(100), jobId: uuid.optional(), invalidates: z.array(nonEmpty.max(200)).max(100),
}).strict()
export const emailCommandErrorSchema = z.object({
  ok: z.literal(false),
  requestId: uuid,
  error: z.object({
    code: nonEmpty.max(100), message: nonEmpty.max(1_000), fieldErrors: z.record(z.string().max(500)).optional(),
    retryable: z.boolean(), currentRevision: revision.optional(), blockedBy: z.array(nonEmpty.max(200)).max(100).optional(),
  }).strict(),
}).strict()
export const emailCommandResultSchema = z.union([emailCommandSuccessSchema, emailCommandErrorSchema])
export type EmailCommandResult = z.infer<typeof emailCommandResultSchema>
export const emailContactAddressSchema = email
