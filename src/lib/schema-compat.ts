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

/** True when an error is a not-yet-migrated column (read or write path). */
export function isMissingColumnError(error: PostgrestError | { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  // SELECT / filter on a missing column → Postgres undefined_column.
  if (error.code === '42703') return true
  // INSERT / UPDATE referencing a column missing from PostgREST's schema cache
  // → PGRST204. This is a DIFFERENT error than the read path, and missing it
  // means write fallbacks never fire (e.g. logging a heir disposition 500s).
  if (error.code === 'PGRST204') return true
  const msg = typeof error.message === 'string' ? error.message : ''
  return /column .* does not exist/i.test(msg)
    || /could not find the .* column .* in the schema cache/i.test(msg)
}

/** Columns added by 20260602_dialer_redesign.sql — optional until applied. */
export const PROSPECT_PHONE_VERIFY_COLUMNS = [
  'is_verified_contact',
  'verified_at',
  'verified_by',
  'verified_source',
] as const

export const LEAD_DEAD_COLUMNS = ['dead_reason', 'dead_at', 'dead_by'] as const
