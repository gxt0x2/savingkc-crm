import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSupabaseAdminKey } from './env'

const KEYS = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('getSupabaseAdminKey', () => {
  it('prefers a long-lived service-role token over a minted API key', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_admin_placeholder'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-static-admin-key'
    expect(getSupabaseAdminKey()).toBe('legacy-static-admin-key')
  })

  it('falls back to the minted key when no long-lived token is configured', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_admin_placeholder'
    expect(getSupabaseAdminKey()).toBe('sb_admin_placeholder')
  })

  it('uses the service-role env when it is the only admin key', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-static-admin-key'
    expect(getSupabaseAdminKey()).toBe('legacy-static-admin-key')
  })
})
