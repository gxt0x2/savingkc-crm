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

const associateMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261205130000_dialer_export_associate_property_dnc.sql'),
  'utf8',
)

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261205120000_dialer_export_suppression.sql'),
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

  it('adds associate, unknown, and property-owner fan-out without clearing a hold', () => {
    expect(associateMigration).toContain("RETURN 'associate_non_family'")
    expect(associateMigration).toContain("RETURN 'relationship_unknown'")
    expect(associateMigration).toContain("RETURN 'property_owner_dnc_fanout'")
    expect(associateMigration).toContain("ARRAY['dead', 'fax']")
    expect(associateMigration).toContain('dialer_multi_line_suspended')
    expect(associateMigration).toContain("'true'::jsonb")
    expect(associateMigration).not.toMatch(/voice_hold\s*=\s*false/)
    expect(associateMigration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(associateMigration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })

  it('classifies raw Mojo labels, keeps stronger stamps, and does not require the encode queue', () => {
    const raw = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261205140000_dialer_export_mojo_raw_and_rehearsal.sql'),
      'utf8',
    )
    expect(raw).toContain("WHEN 'mojo_disposition_raw'")
    expect(raw).toContain('dialer_stamp_rank_v1')
    expect(raw).toContain('dialer_household_key')
    expect(raw).toContain('WITH reviewed AS MATERIALIZED')
    expect(raw).toContain('needs_counsel_review')
    expect(raw).toContain('mojo_dnc_contact_fanout')
    expect(raw).toContain('crm_mojo_calls')
    expect(raw).toContain('disposition_raw')
    expect(raw).toContain('result_label')
    expect(raw).toContain('RETURN false')
    expect(raw).not.toContain('mojo_encode_pending_unreadable')
    expect(raw).not.toMatch(/voice_hold\s*=\s*false/)
    expect(raw).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(raw).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })

  it('ranks unmapped labels above a weak stamp and classifies phones once', () => {
    const speed = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261205150000_dialer_export_speed_f1_stamp.sql'),
      'utf8',
    )
    expect(speed).toContain("WHEN public.dialer_suppression_class_v1('prospect_disposition', label) = 'unmapped' THEN 25")
    expect(speed).toContain('dialer_unknown_tie_release_v1')
    expect(speed).toContain('classified_phones AS MATERIALIZED')
    expect(speed).toContain('registered_agent')
    expect(speed).toContain('out_of_service_area')
    expect(speed).toContain('tax_status_export_allowed_v1')
    expect(speed).toContain('source_list_phone_block_reason_v1(text, text, text)')
    expect(readFileSync(join(process.cwd(), 'supabase/migrations/20261205140000_dialer_export_mojo_raw_and_rehearsal.sql'), 'utf8')).not.toContain("RAISE EXCEPTION 'dialer_label_unmapped")
    expect(speed).not.toMatch(/voice_hold\s*=\s*false/)
    expect(speed).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(speed).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })
})
