import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261127120000_appointment_reschedule_reply_status.sql',
  'utf8',
)
const original = readFileSync(
  'supabase/migrations/20261106120000_appointment_show_rate_sequence.sql',
  'utf8',
)

describe('appointment reschedule reply migration', () => {
  it('marks an SMS reschedule as rescheduled and skips queued reminders', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.appointment_sequence_reply_v1')
    expect(migration).toContain("WHEN p_response='reschedule' THEN 'rescheduled'")
    expect(migration).toContain("reason='seller_reschedule_reply'")
    expect(migration).toContain("status='skipped'")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.appointment_sequence_reply_v1')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.appointment_sequence_reply_v1')
    expect(migration).toContain('TO service_role')
    expect(migration).not.toMatch(/\b(?:sms_send_log|sms_delivery_log|mojo_call_queue)\b/)
  })

  it('leaves the already applied sequence migration unchanged', () => {
    expect(original).toContain("status=CASE WHEN p_response='confirm' THEN 'confirmed' ELSE status END")
    expect(original).not.toContain('seller_reschedule_reply')
  })
})
