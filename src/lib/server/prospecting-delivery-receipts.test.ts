import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260904140000_prospecting_sms_delivery_receipts.sql'), 'utf8')
const proxy = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8')
const worker = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-worker.ts'), 'utf8')

describe('prospecting carrier delivery receipts', () => {
  it('keeps the signed provider callback public and attaches it only to campaign sends', () => {
    expect(proxy).toContain("'/api/twilio-message-status'")
    expect(worker).toContain("new URL('/api/twilio-message-status', base)")
    expect(worker).toContain('statusCallback: deliveryStatusCallback(action.id)')
  })

  it('moves accepted actions to delivered or failed idempotently and stops later cadence on failure', () => {
    expect(migration).toContain('apply_prospecting_sms_delivery_v1')
    expect(migration).toContain("clean_status IN ('delivered', 'read') AND action_row.status = 'sent'")
    expect(migration).toContain("clean_status IN ('failed', 'undelivered') AND action_row.status = 'sent'")
    expect(migration).toContain("WHERE member_id = action_row.member_id AND status = 'queued'")
    expect(migration).toContain("SET status = 'suppressed', suppression_reason = final_error")
  })

  it('keeps the mutation service-only and indexes provider identity uniquely', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_provider_sid')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.apply_prospecting_sms_delivery_v1')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role')
  })
})
