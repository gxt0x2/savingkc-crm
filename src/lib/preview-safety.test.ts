import { afterEach, describe, expect, it, vi } from 'vitest'
import { externalSideEffectsDisabled, previewWriteBlocked } from './preview-safety'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('preview safety', () => {
  it('fails closed for Vercel preview deployments', () => {
    vi.stubEnv('TEST_MODE', 'false')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(externalSideEffectsDisabled()).toBe(true)
  })

  it('fails closed when TEST_MODE is explicitly enabled', () => {
    vi.stubEnv('TEST_MODE', 'true')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(externalSideEffectsDisabled()).toBe(true)
  })

  it('allows external effects only in an explicit production runtime', () => {
    vi.stubEnv('TEST_MODE', 'false')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(externalSideEffectsDisabled()).toBe(false)
  })

  it('makes preview APIs read-only unless staging writes are explicitly enabled', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('PREVIEW_ALLOW_WRITES', 'false')

    expect(previewWriteBlocked('GET', '/api/conversations/hub')).toBe(false)
    expect(previewWriteBlocked('OPTIONS', '/api/leads')).toBe(false)
    expect(previewWriteBlocked('POST', '/api/leads')).toBe(true)
    expect(previewWriteBlocked('PATCH', '/api/leads/tasks/task-1')).toBe(true)
    expect(previewWriteBlocked('POST', '/login')).toBe(false)
  })

  it('allows preview API writes only with the explicit staging override', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('PREVIEW_ALLOW_WRITES', 'true')
    expect(previewWriteBlocked('POST', '/api/leads')).toBe(false)
  })
})
