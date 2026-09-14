import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailAiAvailable } from '../ai/provider'

const context = Symbol.for('@vercel/request-context')
const globals = globalThis as unknown as Record<symbol, unknown>
const originalContext = globals[context]
afterEach(() => {
  vi.unstubAllEnvs()
  if (originalContext === undefined) delete globals[context]
  else globals[context] = originalContext
})

describe('Email AI credential availability', () => {
  it('recognizes hosted request credentials without a local token environment variable', () => {
    vi.stubEnv('EMAIL_AI_ENABLED', 'true')
    vi.stubEnv('AI_GATEWAY_API_KEY', '')
    vi.stubEnv('VERCEL_OIDC_TOKEN', '')
    globals[context] = { get: () => ({ headers: { 'x-vercel-oidc-token': 'test-request-token' } }) }
    expect(emailAiAvailable()).toBe(true)
    vi.stubEnv('EMAIL_AI_ENABLED', 'false')
    expect(emailAiAvailable()).toBe(false)
  })

  it('fails closed without credentials and supports an explicitly configured key', () => {
    vi.stubEnv('EMAIL_AI_ENABLED', 'true')
    vi.stubEnv('AI_GATEWAY_API_KEY', '')
    vi.stubEnv('VERCEL_OIDC_TOKEN', '')
    delete globals[context]
    expect(emailAiAvailable()).toBe(false)
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-api-key')
    expect(emailAiAvailable()).toBe(true)
  })
})
