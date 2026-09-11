import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync('apps/mobile/App.tsx', 'utf8')
const api = readFileSync('apps/mobile/src/lib/api.ts', 'utf8')
const workScreen = readFileSync('apps/mobile/src/components/work-screen.tsx', 'utf8')
const operationsCard = readFileSync('apps/mobile/src/components/lead-operations-card.tsx', 'utf8')
const assistantScreen = readFileSync('apps/mobile/src/components/assistant-screen.tsx', 'utf8')
const twilioVoice = readFileSync('apps/mobile/src/lib/twilio-voice-service.ts', 'utf8')
const twilioTokenRoute = readFileSync('src/app/api/mobile/v1/twilio/token/route.ts', 'utf8')
const environmentExample = readFileSync('.env.example', 'utf8')

describe('mobile operating parity contract', () => {
  it('keeps one mobile Work surface backed by canonical server actions', () => {
    expect(app).toContain("type MobileTab = 'contacts' | 'work' | 'conversations' | 'ari' | 'phone'")
    expect(app).toContain('<WorkScreen accessToken={accessToken}')
    expect(workScreen).toContain('fetchMobileWork')
    expect(workScreen).toContain('completeMobileWorkItem')
    expect(workScreen).toContain('acceptMobileHandoff')
  })

  it('gives mobile users a bearer-authenticated, read-only ARI surface', () => {
    expect(app).toContain('<AssistantScreen accessToken={accessToken}')
    expect(app).toContain('Ask ARI for a briefing')
    expect(api).toContain("'/api/ai/command'")
    expect(api).toContain("'/api/ai/threads?limit=20'")
    expect(api).toContain('requestId: input.requestId')
    expect(assistantScreen).toContain('retryRequest?.content === content')
    expect(assistantScreen).toContain('It can research and recommend, but it cannot change CRM data')
    expect(assistantScreen).toContain('require confirmation')
    expect(assistantScreen).not.toMatch(/supabase|\.from\(/i)
  })

  it('initializes iOS PushKit early and binds the production VoIP credential into mobile tokens', () => {
    expect(app).toContain('void initializeTwilioVoice().catch(() => null)')
    expect(twilioVoice).toContain("Platform.OS !== 'ios'")
    expect(twilioVoice).toContain('voice.initializePushRegistry()')
    expect(twilioTokenRoute).toContain("cleanTwilioEnv('TWILIO_VOIP_PUSH_CREDENTIAL_SID')")
    expect(twilioTokenRoute).toContain('pushCredentialSid,')
    expect(environmentExample).toContain('TWILIO_VOIP_PUSH_CREDENTIAL_SID=')
  })

  it('routes ownership, work completion, and handoff acceptance through bearer-authenticated APIs', () => {
    expect(api).toContain('/api/mobile/v1/work?')
    expect(api).toContain('/api/mobile/v1/leads/${encodeURIComponent(input.leadId)}/owner')
    expect(api).toContain('/api/mobile/v1/work-items/${encodeURIComponent(input.key)}/complete')
    expect(api).toContain('/api/mobile/v1/handoffs/${encodeURIComponent(input.handoffId)}/accept')
    expect(api).toContain("Authorization: `Bearer ${options.accessToken}`")
    expect(api).toContain("'Idempotency-Key': options.idempotencyKey")
  })

  it('shows unavailable task and handoff state instead of false clean zeroes', () => {
    expect(operationsCard).toContain('Task state is unavailable. Nothing is shown as complete.')
    expect(operationsCard).toContain('Handoff state is unavailable.')
    expect(workScreen).toContain('Work is unavailable. Nothing has been marked complete.')
  })

  it('does not add direct database access to native operator components', () => {
    expect(workScreen).not.toMatch(/supabase|\.from\(/i)
    expect(operationsCard).not.toMatch(/supabase|\.from\(/i)
  })
})
