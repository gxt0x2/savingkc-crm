export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

// POST /api/deals/migrate — Add new deal_pages columns (idempotent)
export async function POST(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const db = supabaseAdmin()

  const migrations = [
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS contract_close_date DATE`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS earnest_money NUMERIC`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS inspection_period_days INTEGER`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS financing_terms TEXT`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS repair_estimate_low NUMERIC`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS repair_estimate_high NUMERIC`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS property_condition TEXT`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS parking TEXT`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS contract_notes TEXT`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS assignment_fee NUMERIC`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS videos TEXT[] DEFAULT '{}'`,
    `ALTER TABLE deal_pages ADD COLUMN IF NOT EXISTS inspection_reports JSONB DEFAULT '[]'`,
  ]

  const results = []

  for (const sql of migrations) {
    try {
      const { error } = await db.rpc('exec_sql', { sql_query: sql })
      if (error) {
        results.push({ sql: sql.substring(0, 60) + '...', error: error.message })
      } else {
        results.push({ sql: sql.substring(0, 60) + '...', success: true })
      }
    } catch (err) {
      results.push({ sql: sql.substring(0, 60) + '...', error: String(err) })
    }
  }

  const ok = results.filter(r => 'success' in r).length
  const fail = results.filter(r => 'error' in r).length

  return NextResponse.json({
    message: `Migration complete: ${ok} successful, ${fail} failed`,
    results,
  })
}
