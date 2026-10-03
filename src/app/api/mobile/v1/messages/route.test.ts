import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import smsContract from '@/lib/mobile-api/fixtures/mobile-outbound-sms.json'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

type Receipt = { userId: string; keyHash: string; leadId: string; channel: string; payloadHash: string; state: string; token: string; expires: number; providerId?: string; result?: Record<string, unknown>; providerKey: string }

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  admin: vi.fn(),
  sendLeadSms: vi.fn(),
  resendSend: vi.fn(),
  sideEffectsDisabled: vi.fn(),
  checkAutoAdvance: vi.fn(),
  receipts: new Map<string, Receipt>(),
  activities: new Map<string, Record<string, unknown>>(),
  activityInsertFailures: 0,
  concurrentActivityInsert: false,
  receiptLease: 0,
}))

vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorize,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/preview-safety', () => ({ externalSideEffectsDisabled: mocks.sideEffectsDisabled }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.checkAutoAdvance }))
vi.mock('@/lib/send-lead-sms', () => ({ sendLeadSms: mocks.sendLeadSms }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.resendSend } } }))
vi.mock('@/lib/mobile-api/message-send-receipts', () => ({
  hashMobileMessageKey: (key: string) => `hash:${key}`,
  mobileMessagePayloadHash: (payload: unknown) => JSON.stringify(payload),
  mobileMessageProviderKey: (userId: string, key: string) => `provider:${userId}:${key}`,
  claimMobileMessageSend: async (input: { userId: string; keyHash: string; leadId: string; channel: string; payloadHash: string; providerKey: string }) => {
    const mapKey = `${input.userId}/${input.keyHash}`
    const existing = mocks.receipts.get(mapKey)
    if (!existing) {
      const token = `token-${++mocks.receiptLease}`
      const receipt: Receipt = { ...input, state: 'reserved', token, expires: Date.now() + 120_000 }
      mocks.receipts.set(mapKey, receipt)
      return { kind: 'reserved', token, receiptId: `receipt-${mapKey}`, state: receipt.state, providerId: null, result: null, providerKey: input.providerKey }
    }
    if (existing.leadId !== input.leadId || existing.channel !== input.channel || existing.payloadHash !== input.payloadHash) return { kind: 'conflict' }
    if (['completed', 'failed', 'uncertain'].includes(existing.state)) return { kind: 'replay', status: Number(existing.result?.__status || 200), result: Object.fromEntries(Object.entries(existing.result || {}).filter(([key]) => key !== '__status')) }
    if (existing.expires > Date.now()) return { kind: 'pending' }
    const token = `token-${++mocks.receiptLease}`
    existing.token = token
    existing.expires = Date.now() + 120_000
    return { kind: 'recovered', token, receiptId: `receipt-${mapKey}`, state: existing.state, providerId: existing.providerId || null, result: existing.result || null, providerKey: existing.providerKey }
  },
  transitionMobileMessageSend: async (input: { userId: string; keyHash: string; token: string; from: string; to: string; providerId?: string | null; status: number; result: Record<string, unknown> }) => {
    const receipt = mocks.receipts.get(`${input.userId}/${input.keyHash}`)
    if (!receipt || receipt.token !== input.token || receipt.state !== input.from) throw new Error('stale test receipt lease')
    receipt.state = input.to
    receipt.providerId = input.providerId || receipt.providerId
    receipt.result = { ...input.result, __status: input.status }
    if (input.to === 'completed' || input.to === 'failed' || input.to === 'uncertain') receipt.expires = 0
  },
}))

import { POST } from '@/app/api/mobile/v1/messages/route'

function request(body: Record<string, unknown>, key?: string) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/messages', {
    method: 'POST',
    headers: { ...(key ? { 'Idempotency-Key': key } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const emailBody = { leadId: 'lead-1', channel: 'email', body: 'Synthetic message' }

// Explicit opt-in when both independent repositories are available. Normal
// backend CI still covers the history-only contract with route tests below.
const mobileSource = process.env.SAVINGKC_MOBILE_SOURCE
function mobileDeclarations(file: string, names: string[]) {
  const filename = join(mobileSource!, file)
  const ast = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) declarations.push(`const ${node.getText(ast)};`)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  expect(declarations).toHaveLength(names.length)
  return ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

type TestCommand = { accountId: string; leadId: string; body: string; kind: string; extra: { idempotencyKey: string; subject?: string; reconcileOnly?: boolean }; accepted: boolean }
type TestResult = { persisted: boolean; sent: boolean }
type TestSender = (body: string, kind: string, extra: TestCommand['extra']) => Promise<TestResult>
type TestRecovery = {
  snapshot: { scope: string | null; command: TestCommand | null };
  select: (accountId: string, leadId: string) => Promise<void>;
  submit: (scope: string, command: TestCommand, sender: TestSender) => Promise<TestResult | undefined>;
  repair: (scope: string, sender: TestSender) => Promise<TestResult | undefined>;
}

function mobileRecoveryModule() {
  const recoveryModule = { exports: {} as Record<string, unknown> }
  const compiled = ts.transpileModule(readFileSync(join(mobileSource!, 'src/messageSendRecovery.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function('module', 'exports', compiled)(recoveryModule, recoveryModule.exports)
  return recoveryModule.exports as {
    MessageSendRecovery: new (storage: { read: (key: string) => Promise<string | null>; write: (key: string, raw: string) => Promise<void>; remove: (key: string) => Promise<void> }) => TestRecovery;
    messageSendStatus: (result: unknown) => unknown;
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.receipts.clear()
  mocks.activities.clear()
  mocks.activityInsertFailures = 0
  mocks.concurrentActivityInsert = false
  mocks.receiptLease = 0
  vi.stubEnv('RESEND_API_KEY', 'local-fake-key')
  mocks.authorize.mockImplementation(async (_req: Request, leadId: string) => ({
    actor: { email: 'casey@savingkc.com', fullName: 'Casey' },
    user: { id: 'user-1', email: 'casey@savingkc.com' },
    lead: { id: leadId },
  }))
  mocks.admin.mockReturnValue({ from: (table: string) => {
    let payload: Record<string, unknown> | null = null
    const filters: Array<[string, unknown]> = []
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      maybeSingle: async () => {
        if (table === 'leads') return { data: { id: 'lead-1', phone: '+18165550100', email: 'seller@example.invalid' }, error: null }
        const command = filters.find(([key]) => key === 'metadata->>mobile_message_command_id')?.[1]
        return { data: command ? mocks.activities.get(String(command)) || null : null, error: null }
      },
      insert: (value: Record<string, unknown>) => {
        payload = value
        const promise = Promise.resolve().then(() => {
          if (mocks.activityInsertFailures > 0) {
            mocks.activityInsertFailures -= 1
            return { error: { message: 'activity database unavailable' } }
          }
          const metadata = payload?.metadata as Record<string, unknown>
          if (mocks.concurrentActivityInsert) {
            mocks.concurrentActivityInsert = false
            mocks.activities.set(String(metadata.mobile_message_command_id), payload!)
            return { error: { code: '23505', message: 'duplicate key lead_activities_mobile_message_command_id' } }
          }
          mocks.activities.set(String(metadata.mobile_message_command_id), payload!)
          return { error: null }
        })
        return { then: promise.then.bind(promise) }
      },
    }
    return chain
  } })
  mocks.sendLeadSms.mockResolvedValue({ status: 'sent', sid: 'SM-fixture', from: '+18163077835', persisted: true, deliveryState: 'delivered_and_persisted' })
  mocks.resendSend.mockResolvedValue({ data: { id: 'email-provider-fixture' }, error: null })
  mocks.sideEffectsDisabled.mockReturnValue(false)
  mocks.checkAutoAdvance.mockResolvedValue(undefined)
})

describe('mobile outbound message command receipts', () => {
  it.runIf(Boolean(mobileSource)).each(['sms', 'email'])('cross-repository production composer retains accepted %s and repairs after account change/reopen without another provider submission', async (kind) => {
    const { MessageSendRecovery, messageSendStatus } = mobileRecoveryModule()
    const values = new Map<string, string>()
    const storage = { read: async (key: string) => values.get(key) || null, write: async (key: string, raw: string) => { values.set(key, raw) }, remove: async (key: string) => { values.delete(key) } }
    let recovery = new MessageSendRecovery(storage)
    await recovery.select('user-1', 'lead-1')
    const scope = recovery.snapshot.scope!
    const key = 'production-composer-repair'
    const state: Record<string, unknown> = { body: 'Synthetic SMS', key }
    const sender: TestSender = async (body, channel, extra) => {
      const response = await POST(request({ leadId: 'lead-1', body, channel, ...(channel === 'sms' ? { template_id: smsContract.payload.template_id } : { subject: extra.subject }), ...(extra.reconcileOnly ? { reconcileOnly: true } : {}) }, extra.idempotencyKey))
      const result = await response.json()
      if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status })
      return result
    }
    const env: Record<string, unknown> = {
      recovery: {
        scope,
        get command() { return recovery.snapshot.command },
        submit: (body: string, channel: string, extra: TestCommand['extra'], send: TestSender) => recovery.submit(scope, { accountId: 'user-1', leadId: 'lead-1', body, kind: channel, extra, accepted: false }, send),
        repair: (send: TestSender) => recovery.repair(scope, send),
      },
      activeScope: { current: scope }, recoveryBlocked: false, pending: false, smsBlockedReason: null, emailBlockedReason: null,
      composerSendAction: () => ({ kind: 'send' }), hasUsableEmail: () => true, toEmail: 'seller@example.invalid',
      emailBody: state.body, subject: 'Synthetic subject', attachments: [],
      setPending: (value: unknown) => { state.pending = value }, setSendStatus: (value: unknown) => { state.status = value },
      setAttachments: () => {}, setIdempotencyKey: (value: string) => { state.key = value }, createIdempotencyKey: () => 'next-command-key',
      idempotencyKey: key, setSmsText: (value: string) => { state.body = value }, setEmailBody: (value: string) => { state.body = value },
      normalizeMobileMediaMime: () => '', validateMobileMmsDraft: () => null, validateEmailAttachmentDraft: () => null, uploadDraftAttachments: async () => [],
      mediaUploadErrorMessage: (error: Error) => error.message, messageSendStatus, onSend: sender,
    }
    const compiled = mobileDeclarations('src/components/MessageComposer.tsx', ['clearSentDraft', 'finishMessageSend', 'repairHistory', 'sendSmsDraft', 'sendEmail'])
    const handlers = new Function(...Object.keys(env), `${compiled}\nreturn {sendSmsDraft, sendEmail, repairHistory};`)(...Object.values(env)) as { sendSmsDraft: (body: string, attachments: unknown[]) => Promise<void>; sendEmail: () => Promise<void>; repairHistory: () => Promise<void> }
    mocks.activityInsertFailures = 1
    if (kind === 'sms') await handlers.sendSmsDraft(String(state.body), [])
    else await handlers.sendEmail()
    expect(state.body).toBe('Synthetic SMS')
    expect(state.key).toBe(key)
    expect(state.status).toMatchObject({ tone: 'warning' })
    expect(recovery.snapshot.command?.accepted).toBe(true)
    expect(mocks.activities.size).toBe(0)

    recovery = new MessageSendRecovery(storage)
    await recovery.select('user-2', 'lead-1')
    expect(recovery.snapshot.command).toBeNull()
    await recovery.select('user-1', 'lead-1')
    expect(recovery.snapshot.command?.extra.idempotencyKey).toBe(key)
    await handlers.repairHistory() // active receipt lease: retained, no send
    expect(state.key).toBe(key)
    expect(recovery.snapshot.command).not.toBeNull()
    mocks.receipts.get(`user-1/hash:${key}`)!.expires = 0
    await handlers.repairHistory()
    expect(state.body).toBe('')
    expect(state.key).toBe('next-command-key')
    // Finished sends live on the message; the composer retains only actionable feedback.
    expect(state.status).toBeNull()
    expect(recovery.snapshot.command).toBeNull()
    expect(values.size).toBe(0)
    expect(mocks.activities.size).toBe(1)
    expect(mocks.sendLeadSms).toHaveBeenCalledTimes(kind === 'sms' ? 1 : 0)
    expect(mocks.resendSend).toHaveBeenCalledTimes(kind === 'email' ? 1 : 0)
  })

  it('accepts the actual live mobile SMS contract without dropping its template', async () => {
    const response = await POST(request(smsContract.payload, smsContract.idempotencyKey))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: true, persisted: true })
    expect(mocks.sendLeadSms).toHaveBeenCalledWith(expect.objectContaining({
      leadId: smsContract.payload.leadId,
      body: smsContract.payload.body,
      metadata: expect.objectContaining({ template_id: smsContract.payload.template_id }),
    }))
    expect([...mocks.activities.values()][0]).toMatchObject({ metadata: { template_id: smsContract.payload.template_id } })
  })

  it.each([null, 17, {}, '', 'sms.broadcast.v1', 'sms.conversation.1to1.v1 '])('rejects an unsupported SMS template before claiming or sending: %j', async (template_id) => {
    const response = await POST(request({ ...smsContract.payload, template_id }, smsContract.idempotencyKey))
    expect(response.status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect(mocks.receipts.size).toBe(0)
  })

  it('rejects the SMS template on an email command', async () => {
    const response = await POST(request({ ...emailBody, template_id: smsContract.payload.template_id }, 'email-template-key'))
    expect(response.status).toBe(400)
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('binds the supplied template to the durable SMS command fingerprint', async () => {
    await POST(request(smsContract.payload, smsContract.idempotencyKey))
    const withoutTemplate: Record<string, unknown> = { ...smsContract.payload }
    delete withoutTemplate.template_id
    const response = await POST(request(withoutTemplate, smsContract.idempotencyKey))
    expect(response.status).toBe(409)
    expect(mocks.sendLeadSms).toHaveBeenCalledOnce()
  })

  it.each([
    { status: 'skipped', reason: 'opted_out' },
    { status: 'failed', error: 'SMS sender is not approved for conversations' },
  ])('keeps the server SMS policy rejection for the valid mobile template: %j', async (result) => {
    mocks.sendLeadSms.mockResolvedValueOnce(result)
    const response = await POST(request(smsContract.payload, smsContract.idempotencyKey))
    expect(response.status).toBe(result.status === 'skipped' ? 400 : 502)
    expect(await response.json()).not.toMatchObject({ sent: true })
    expect(mocks.activities.size).toBe(0)
    expect(mocks.receipts.get(`user-1/hash:${smsContract.idempotencyKey}`)?.state).toBe('failed')
  })

  it('does not report success when Resend returns a resolved error', async () => {
    mocks.resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'rejected' } })
    const response = await POST(request(emailBody, 'stable-email-key'))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ sent: false })
    expect(mocks.receipts.get('user-1/hash:stable-email-key')?.state).toBe('failed')
  })

  it('recovers CRM history after provider acceptance without sending again', async () => {
    mocks.activityInsertFailures = 1
    const first = await POST(request(emailBody, 'accepted-write-failure'))
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ sent: true, persisted: false })
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
    const pending = await POST(request(emailBody, 'accepted-write-failure'))
    expect(pending.status).toBe(409)
    mocks.receipts.get('user-1/hash:accepted-write-failure')!.expires = 0
    const retry = await POST(request(emailBody, 'accepted-write-failure'))
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ sent: true, persisted: true })
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
    expect(mocks.activities.size).toBe(1)
  })

  it('passes the stable Resend idempotency key and reuses it for provider replay', async () => {
    const response = await POST(request(emailBody, 'stable-email-key'))
    expect(response.status).toBe(200)
    expect(mocks.resendSend).toHaveBeenCalledWith(expect.objectContaining({ to: ['seller@example.invalid'] }), { idempotencyKey: 'provider:user-1:stable-email-key' })
  })

  it('rejects a same-key payload change before another provider send', async () => {
    await POST(request(emailBody, 'stable-email-key'))
    const response = await POST(request({ ...emailBody, body: 'Changed content' }, 'stable-email-key'))
    expect(response.status).toBe(409)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })

  it('requires an Idempotency-Key before provider work', async () => {
    const response = await POST(request(emailBody))
    expect(response.status).toBe(400)
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it.each([
    { ...emailBody, attachmentIds: ['doc-1'] },
    { ...emailBody, messageKind: 'voice', durationSec: 4 },
    { ...emailBody, waveform: [0.1, 0.2] },
  ])('rejects unsupported attachment and voice payloads without sending', async (payload) => {
    const response = await POST(request(payload, 'unsupported-key'))
    expect(response.status).toBe(400)
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
  })

  it('accepts the mobile text-message defaults while keeping attachment behavior strict', async () => {
    const response = await POST(request({ ...emailBody, messageKind: 'text', attachmentIds: [] }, 'text-default-key'))
    expect(response.status).toBe(200)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent same-key submissions behind the durable claim', async () => {
    let release!: (value: unknown) => void
    mocks.resendSend.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const firstPromise = POST(request(emailBody, 'concurrent-key'))
    await vi.waitFor(() => expect(mocks.resendSend).toHaveBeenCalledTimes(1))
    const second = await POST(request(emailBody, 'concurrent-key'))
    expect(second.status).toBe(409)
    release({ data: { id: 'email-provider-fixture' }, error: null })
    expect((await firstPromise).status).toBe(200)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })

  it('scopes identical idempotency keys independently to authenticated users', async () => {
    await POST(request(emailBody, 'account-scoped-key'))
    mocks.authorize.mockImplementationOnce(async (_req: Request, leadId: string) => ({
      actor: { email: 'ernest@savingkc.com', fullName: 'Ernest' },
      user: { id: 'user-2', email: 'ernest@savingkc.com' },
      lead: { id: leadId },
    }))
    const second = await POST(request(emailBody, 'account-scoped-key'))
    expect(second.status).toBe(200)
    expect(mocks.resendSend).toHaveBeenCalledTimes(2)
  })

  it('does not claim that preview-mode email was sent', async () => {
    mocks.sideEffectsDisabled.mockReturnValue(true)
    const response = await POST(request(emailBody, 'preview-key'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: false, deliveryState: 'not_sent_preview' })
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect([...mocks.activities.values()][0]).toMatchObject({ metadata: { sent: false } })
  })

  it('does not call the SMS sender or report sent in preview mode', async () => {
    mocks.sideEffectsDisabled.mockReturnValue(true)
    const response = await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, 'sms-preview-key'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: false, deliveryState: 'not_sent_preview' })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect([...mocks.activities.values()][0]).toMatchObject({ metadata: { sent: false } })
  })

  it('does not repeat an SMS provider call after accepted activity persistence failed', async () => {
    mocks.activityInsertFailures = 1
    mocks.sendLeadSms.mockResolvedValueOnce({ status: 'sent', sid: 'SM-fixture', from: '+18163077835', persisted: false, deliveryState: 'delivered_not_persisted', warning: 'Do not resend.' })
    const first = await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, 'sms-recovery-key'))
    expect(first.status).toBe(202)
    expect((await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, 'sms-recovery-key'))).status).toBe(409)
    mocks.receipts.get('user-1/hash:sms-recovery-key')!.expires = 0
    const retry = await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, 'sms-recovery-key'))
    expect(retry.status).toBe(200)
    expect(mocks.sendLeadSms).toHaveBeenCalledTimes(1)
    expect(mocks.activities.size).toBe(1)
  })

  it.each(['sms', 'email'])('a history-only command with a missing receipt never submits to the %s provider', async (channel) => {
    const payload = channel === 'sms' ? smsContract.payload : emailBody
    const response = await POST(request({ ...payload, reconcileOnly: true }, 'missing-repair-key'))
    expect(response.status).toBe(409)
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it.each(['sms', 'email'])('repairs accepted %s history with the same command and zero additional provider submissions', async (channel) => {
    const payload = channel === 'sms' ? smsContract.payload : emailBody
    const key = 'explicit-history-repair'
    mocks.activityInsertFailures = 1
    const first = await POST(request(payload, key))
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ sent: true, persisted: false })
    mocks.receipts.get(`user-1/hash:${key}`)!.expires = 0
    const repaired = await POST(request({ ...payload, reconcileOnly: true }, key))
    expect(repaired.status).toBe(200)
    expect(await repaired.json()).toMatchObject({ sent: true, persisted: true })
    expect(mocks.sendLeadSms).toHaveBeenCalledTimes(channel === 'sms' ? 1 : 0)
    expect(mocks.resendSend).toHaveBeenCalledTimes(channel === 'email' ? 1 : 0)
    expect(mocks.activities.size).toBe(1)
    const replay = await POST(request({ ...payload, reconcileOnly: true }, key))
    expect(replay.status).toBe(200)
    expect(mocks.activities.size).toBe(1)
  })

  it('a history-only email command with unconfirmed provider acceptance never repeats the provider call', async () => {
    const key = 'email-unconfirmed-repair'
    mocks.resendSend.mockRejectedValueOnce(new Error('uncertain provider transport'))
    expect((await POST(request(emailBody, key))).status).toBe(503)
    mocks.receipts.get(`user-1/hash:${key}`)!.expires = 0
    expect((await POST(request({ ...emailBody, reconcileOnly: true }, key))).status).toBe(409)
    expect(mocks.resendSend).toHaveBeenCalledOnce()
  })

  it('rejects a nonboolean history-only flag', async () => {
    expect((await POST(request({ ...smsContract.payload, reconcileOnly: 'true' }, 'invalid-repair-flag'))).status).toBe(400)
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
  })

  it('reconciles a concurrent canonical history insert without creating a duplicate or resending', async () => {
    mocks.concurrentActivityInsert = true
    const response = await POST(request(emailBody, 'overlapping-history-key'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: true, persisted: true })
    expect(mocks.activities.size).toBe(1)
    expect(mocks.resendSend).toHaveBeenCalledOnce()
  })

  it('reconciles a persisted SMS activity after a worker crash without another provider call', async () => {
    const key = 'sms-crash-key'
    const keyHash = `hash:${key}`
    const mapKey = `user-1/${keyHash}`
    mocks.receipts.set(mapKey, {
      userId: 'user-1', keyHash, leadId: 'lead-1', channel: 'sms', payloadHash: JSON.stringify({ leadId: 'lead-1', channel: 'sms', to: '+18165550100', subject: null, body: 'Synthetic SMS' }),
      state: 'sending', token: 'expired-token', expires: 0, providerKey: 'provider:user-1:sms-crash-key',
    })
    const receiptId = `receipt-${mapKey}`
    mocks.activities.set(receiptId, { id: 'activity-existing', metadata: { mobile_message_command_id: receiptId, message_sid: 'SM-existing', from: '+18163077835' } })

    const response = await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, key))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sent: true, persisted: true, sid: 'SM-existing' })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
  })

  it('makes stale SMS provider attempts terminal when no persisted outcome can be reconciled', async () => {
    const key = 'sms-ambiguous-key'
    const keyHash = `hash:${key}`
    const mapKey = `user-1/${keyHash}`
    mocks.receipts.set(mapKey, {
      userId: 'user-1', keyHash, leadId: 'lead-1', channel: 'sms', payloadHash: JSON.stringify({ leadId: 'lead-1', channel: 'sms', to: '+18165550100', subject: null, body: 'Synthetic SMS' }),
      state: 'sending', token: 'expired-token', expires: 0, providerKey: 'provider:user-1:sms-ambiguous-key',
    })

    const response = await POST(request({ leadId: 'lead-1', channel: 'sms', body: 'Synthetic SMS' }, key))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('unknown') })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect(mocks.receipts.get(mapKey)?.state).toBe('uncertain')
  })
})
