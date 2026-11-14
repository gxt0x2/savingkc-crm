import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261203140000_sanctioned_prospect_merge.sql'),
  'utf8',
)
const rehearsal = readFileSync(join(process.cwd(), 'tests/prospect-merge-db.sql'), 'utf8')

describe('sanctioned prospect merge migration', () => {
  it('adds a survivor pointer and keeps phone rows', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS merged_into_id uuid')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT \'active\'')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS merged_at timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS merged_by text')
    expect(migration).toContain('CHECK (record_status IN (\'active\', \'merged\'))')
    expect(migration).toContain('CHECK (merged_into_id <> id)')
    expect(migration).toContain('REFERENCES public.prospects(id)')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_prospect_id uuid')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS relationship_detail text')
    expect(migration).toContain('p_dry_run boolean DEFAULT true')
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).not.toMatch(/\b(?:ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM)\s+public\.crm_people\b/i)
  })

  it('re-points phones, the lead link, and campaign members without clearing a hold', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.merge_prospects_v1(')
    expect(migration).toContain('prospect_merge_target_merged')
    expect(migration).toContain('prospect_merge_deleted_rows')
    expect(migration).toContain('prospect_merge_hold_or_dnc_changed')
    expect(migration).toContain('voice_hold = phone.voice_hold OR')
    expect(migration).toContain("'associate_relationship'")
    expect(migration).toContain("ARRAY['friend', 'coworker', 'neighbor', 'past_neighbor', 'landlord', 'tenant']")
    expect(migration).toContain("ARRAY['dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead']")
    expect(migration).toContain("dialer_suppression_class_v1($1, $2)")
    expect(migration).toContain("'never_downgrade'")
    expect(migration).toContain('UPDATE public.lead_activities AS activity')
    expect(migration).toContain('UPDATE public.prospecting_campaign_members AS member')
    expect(migration).toContain("'prospect_merged'")
    expect(migration).not.toMatch(/last_disposition\s*=/)
  })

  it('marks merged prospects non-dialable and follows merged_into_id', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.prospect_dial_subject_id_v1(p_prospect_id uuid)')
    expect(migration).toContain('prospect_phone.prospect_id = public.prospect_dial_subject_id_v1(row.prospect_id)')
    expect(migration).toContain("WHEN dialed.prospect_record_status = 'merged' THEN 'merged_prospect'")
    expect(migration).toContain('CREATE OR REPLACE VIEW public.source_list_dialer_phone_review')
    expect(migration).toContain('PR #814')
  })
})

describe('prospect merge rehearsal fixture', () => {
  it('models the 20-record household with fictional 555 numbers', () => {
    expect(rehearsal).toContain("+1816555")
    expect(rehearsal).toContain("(1, 'Owner', 10)")
    expect(rehearsal).toContain("(2, 'Friend', 1)")
    expect(rehearsal).toContain("(5, 'Coworker', 1)")
    expect(rehearsal).toContain("(9, 'Past neighbor', 1)")
    expect(rehearsal).toContain("(12, 'In-law', 2)")
    expect(rehearsal).toContain('household plan must be 49 phones')
    expect(rehearsal).toContain('household phones were not all kept on hold and dnc')
    expect(rehearsal).toContain('relationship_detail was not preserved')
    expect(rehearsal).toContain('re-run was not idempotent')
    expect(rehearsal).toContain('prospect_merge_target_merged')
    expect(rehearsal).toContain('merge into a merged target was allowed')
    expect(rehearsal).not.toMatch(/\+1(?!816555)\d{10}/)
  })
})
