import { describe, expect, it } from 'vitest'
import { EMAIL_COMMAND_IDS, emailCommandResultSchema, emailCommandSchema } from '../contracts'

const id = '123e4567-e89b-12d3-a456-426614174000'
const key = '123e4567-e89b-12d3-a456-426614174001'
const documentedServerCommands = [
  'SET-BUSINESS', 'SVC-CONNECT', 'SVC-SIGNUP', 'SVC-CHECK', 'SVC-DISCONNECT', 'SET-TEAM', 'SET-AUTOMATION', 'SET-BUDGET', 'SET-READINESS', 'SET-FINISH', 'SET-ENABLE', 'SET-PAUSE',
  'AUD-CREATE', 'AUD-UPLOAD', 'AUD-MAP', 'AUD-REFRESH', 'AUD-RESOLVE', 'AUD-VERIFY', 'AUD-EXCLUDE', 'AUD-PREPARE', 'AUD-ARCHIVE',
  'CAM-CREATE', 'CAM-SAVE', 'CAM-PREVIEW', 'CAM-TEST', 'CAM-LAUNCH', 'CAM-PAUSE', 'CAM-RESUME', 'CAM-REVISE', 'CAM-DUPLICATE', 'CAM-STOP-RECIPIENT', 'CAM-ARCHIVE',
  'THR-READ', 'THR-TAKEOVER', 'THR-TRANSFER', 'THR-RELEASE', 'THR-DRAFT', 'THR-NOTE', 'THR-SEND', 'THR-REGENERATE', 'THR-SNOOZE', 'THR-CLOSE', 'THR-TAG', 'THR-LINK', 'THR-HANDOFF',
  'REV-APPROVE', 'REV-REJECT', 'REV-ASSIGN', 'REV-RESOLVE', 'INB-SAVEVIEW', 'INB-DELETEVIEW',
  'HAN-ACCEPT', 'HAN-REASSIGN', 'HAN-SCHEDULE', 'HAN-OUTCOME', 'HAN-QUALIFY', 'HAN-RETURN',
  'PB-SAVE', 'PB-SIMULATE', 'PB-PUBLISH', 'DOM-ADD', 'DOM-VERIFY', 'DOM-PAUSE', 'SND-SAVE', 'SND-TEST', 'SET-ROLES', 'SET-RETENTION', 'SUP-ADD', 'SUP-RELEASE', 'OPS-REPLAY', 'OPS-RECONCILE', 'OPS-ACK',
  'RPT-EXPORT', 'PUB-UNSUBSCRIBE', 'PUB-PREFERENCE', 'COP-GENERATE', 'COP-REVIEW', 'NTF-TEST', 'NTF-ACK', 'SCH-POLICY', 'SCH-RESCHEDULE', 'SCH-CANCEL', 'TEL-SAVE', 'TEL-TEST',
] as const

describe('email command contracts', () => {
  it('owns every documented server command, while read-only and external navigation stay out of mutation input', () => {
    expect([...EMAIL_COMMAND_IDS].sort()).toEqual([...documentedServerCommands].sort())
    expect(EMAIL_COMMAND_IDS).not.toContain('RPT-QUERY')
    expect(EMAIL_COMMAND_IDS).not.toContain('PUB-CONTACT')
  })

  it('rejects client workspace authority and unknown envelope keys', () => {
    expect(emailCommandSchema.safeParse({
      command: 'SET-PAUSE', idempotencyKey: key, payload: { reason: 'Investigating a delivery incident' }, workspaceId: id,
    }).success).toBe(false)
  })

  it('rejects extra action payload fields instead of passing them through to handlers', () => {
    expect(emailCommandSchema.safeParse({
      command: 'CAM-PAUSE', idempotencyKey: key, payload: { reason: 'A complaint needs review', bypassSuppression: true },
    }).success).toBe(false)
  })

  it('does not permit credentials in the dedicated connection command', () => {
    expect(emailCommandSchema.safeParse({
      command: 'SVC-CONNECT', idempotencyKey: key, payload: { apiKey: 'must-not-be-accepted-here' },
    }).success).toBe(false)
  })

  it('requires immutable launch evidence and a stable idempotency key', () => {
    expect(emailCommandSchema.safeParse({
      command: 'CAM-LAUNCH', idempotencyKey: key,
      payload: { draftHash: 'draft-hash', audienceHash: 'audience-hash', readinessRunId: id, approvedMaxRecipients: 25, estimateHash: 'estimate-hash' },
    }).success).toBe(true)
    expect(emailCommandSchema.safeParse({
      command: 'CAM-LAUNCH', idempotencyKey: 'not-a-uuid',
      payload: { draftHash: 'draft-hash', audienceHash: 'audience-hash', approvedMaxRecipients: 25 },
    }).success).toBe(false)
  })

  it('does not let an acquisitions qualification omit one of the four evidence pillars', () => {
    expect(emailCommandSchema.safeParse({
      command: 'HAN-QUALIFY', idempotencyKey: key,
      payload: {
        handoffId: id, leadId: id, leadRevision: 1,
        assessment: {
          personAuthority: { state: 'confirmed', evidenceIds: [id] }, propertyRef: '123 Main Street',
          timeline: { state: 'verified', evidenceIds: [id] }, condition: { state: 'verified', evidenceIds: [id] },
          motivation: { state: 'verified', evidenceIds: [id] }, whyWorthPursuing: 'Seller asked to discuss a possible sale.',
        },
        nextAction: 'Call after 2 PM', evidenceIds: [id],
      },
    }).success).toBe(false)
  })

  it('uses strict durable result envelopes', () => {
    expect(emailCommandResultSchema.safeParse({
      ok: true, requestId: key, entityId: id, revision: 1, state: 'queued',
      invalidates: ['email:campaigns'], unknown: true,
    }).success).toBe(false)
  })
})
