// Graceful-degradation helpers for when a migration hasn't reached an
// environment yet. Lets a route fall back (reduced SELECT / stripped patch)
// instead of 500ing the whole feature on a missing column.
//
// Context: code can deploy ahead of its DB migration (e.g. Vercel ships the
// build, but supabase/migrations/*.sql is applied separately). Until the
// migration runs, queries that reference the new columns error with Postgres
// 42703 / PostgREST "column ... does not exist". These helpers let the read
// path degrade (omit the new fields) and the write path persist everything
// except the not-yet-existing columns.

import type { PostgrestError } from '@supabase/supabase-js'

/** True when an error is Postgres "undefined_column" (a not-yet-migrated column). */
export function isMissingColumnError(error: PostgrestError | { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42703') return true // undefined_column
  return typeof error.message === 'string' && /column .* does not exist/i.test(error.message)
}

/** Columns added by 20260602_dialer_redesign.sql — optional until applied. */
export const PROSPECT_PHONE_VERIFY_COLUMNS = [
  'is_verified_contact',
  'verified_at',
  'verified_by',
  'verified_source',
] as const

export const LEAD_DEAD_COLUMNS = ['dead_reason', 'dead_at', 'dead_by'] as const
