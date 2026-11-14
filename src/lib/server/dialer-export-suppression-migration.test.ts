import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEAD_CALL_ALLOW,
  LEAD_CALL_DEAD,
  LEAD_DEAD_ALLOW,
  LEAD_DEAD_DISCONNECTED,
  LEAD_DEAD_PERSON,
  LEAD_DEAD_PHONE_DNC,
  MOJO_ALLOW,
  PHONE_CONNECTED_ALLOW,
  PHONE_CONNECTED_DISCONNECTED,
  PROSPECT_ALLOW,
  PROSPECT_DEAD,
  PROSPECT_PERSON_DNC,
  PROSPECT_PHONE_DNC,
  PROSPECT_WRONG,
} from '@/lib/dialer-suppression-policy'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261202140000_dialer_export_suppression.sql'),
  'utf8',
)

function policyList(name: string): string[] {
  const match = migration.match(new RegExp(`-- BEGIN policy ${name}\\s*ARRAY\\[([^\\]]+)\\]`))
  if (!match?.[1]) throw new Error(`missing policy ${name}`)
  return match[1].split(',').map((item) => item.trim().replaceAll("'", ''))
}

describe('dialer export suppression migration', () => {
  it('keeps the SQL label sets aligned with the shared policy', () => {
    expect(policyList('prospect_phone_dnc')).toEqual([...PROSPECT_PHONE_DNC])
    expect(policyList('prospect_person_dnc')).toEqual([...PROSPECT_PERSON_DNC])
    expect(policyList('prospect_dead')).toEqual([...PROSPECT_DEAD])
    expect(policyList('prospect_wrong')).toEqual([...PROSPECT_WRONG])
    expect(policyList('prospect_allow')).toEqual([...PROSPECT_ALLOW])
    expect(policyList('phone_connected_allow')).toEqual([...PHONE_CONNECTED_ALLOW])
    expect(policyList('phone_connected_disconnected')).toEqual([...PHONE_CONNECTED_DISCONNECTED])
    expect(policyList('lead_call_dead')).toEqual([...LEAD_CALL_DEAD])
    expect(policyList('lead_call_allow')).toEqual([...LEAD_CALL_ALLOW])
    expect(policyList('lead_dead_phone_dnc')).toEqual([...LEAD_DEAD_PHONE_DNC])
    expect(policyList('lead_dead_person')).toEqual([...LEAD_DEAD_PERSON])
    expect(policyList('lead_dead_disconnected')).toEqual([...LEAD_DEAD_DISCONNECTED])
    expect(policyList('lead_dead_allow')).toEqual([...LEAD_DEAD_ALLOW])
    expect(policyList('mojo_allow')).toEqual([...MOJO_ALLOW])
  })

  it('shares the never-downgrade set with the blocker and does not touch the call queue', () => {
    expect(migration).toContain("WHEN label = ANY (policy.prospect_phone_dnc || policy.prospect_person_dnc || ARRAY['dead']) THEN 'protected'")
    const stamp = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1'))
    expect(stamp).toContain("dialer_suppression_class_v1('never_downgrade'")
    expect(stamp).not.toContain("'dnc_contact', 'dnc_number', 'take_me_off', 'dead'")
    expect(migration).toContain('person_fanout')
    expect(migration).toContain('household_fanout')
    expect(migration).toContain('mojo_dnc')
    expect(migration).toContain('hold_last4')
    expect(migration).toContain('mojo_encode_pending')
    expect(migration).toContain('dataskip_dnc')
    expect(migration).toContain('dialer_phone_mask_v1')
    expect(migration).toContain('source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id)')
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })
})
