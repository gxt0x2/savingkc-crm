import { describe, it, expect } from 'vitest'
import { isMissingColumnError } from './schema-compat'

describe('isMissingColumnError', () => {
  it('matches Postgres undefined_column code 42703', () => {
    expect(isMissingColumnError({ code: '42703', message: 'whatever' })).toBe(true)
  })

  it('matches the PostgREST "column ... does not exist" message', () => {
    expect(isMissingColumnError({ message: 'column prospect_phones.is_verified_contact does not exist' })).toBe(true)
    expect(isMissingColumnError({ message: 'column "dead_reason" does not exist' })).toBe(true)
  })

  it('matches the PostgREST write-side schema-cache miss (PGRST204)', () => {
    // INSERT/UPDATE on a not-yet-migrated column reports this, NOT 42703.
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'is_verified_contact' column of 'prospect_phones' in the schema cache" })).toBe(true)
    expect(isMissingColumnError({ message: "Could not find the 'verified_source' column of 'prospect_phones' in the schema cache" })).toBe(true)
  })

  it('is false for unrelated errors', () => {
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(isMissingColumnError({ message: 'permission denied for table leads' })).toBe(false)
  })

  it('is false for null/undefined', () => {
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError(undefined)).toBe(false)
  })
})
