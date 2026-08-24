import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync('apps/mobile/App.tsx', 'utf8')
const api = readFileSync('apps/mobile/src/lib/api.ts', 'utf8')
const workScreen = readFileSync('apps/mobile/src/components/work-screen.tsx', 'utf8')
const operationsCard = readFileSync('apps/mobile/src/components/lead-operations-card.tsx', 'utf8')

describe('mobile operating parity contract', () => {
  it('keeps one mobile Work surface backed by canonical server actions', () => {
    expect(app).toContain("type MobileTab = 'contacts' | 'work' | 'conversations' | 'phone'")
    expect(app).toContain('<WorkScreen accessToken={accessToken}')
    expect(workScreen).toContain('fetchMobileWork')
    expect(workScreen).toContain('completeMobileWorkItem')
    expect(workScreen).toContain('acceptMobileHandoff')
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
