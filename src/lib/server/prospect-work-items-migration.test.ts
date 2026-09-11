import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261102130000_prospect_work_items.sql'),
  'utf8',
)

describe('source Prospect canonical work migration', () => {
  it('keeps work attached to the Prospect and preserves identity through promotion', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects')
    expect(migration).toContain("row_value.activity_type NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail')")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_work_item_v3')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sync_prospect_activity_lead_v1')
    expect(migration).toContain("'activity:' || row_value.id::text")
    expect(migration).toContain("prospect.lead_id IS NULL")
    expect(migration).toContain("'''prospectId'', row.prospect_id")
  })

  it('re-projects preexisting prospect work after installing the typed trigger', () => {
    const triggerIndex = migration.indexOf('CREATE TRIGGER trigger_sync_activity_work_item_v1')
    const backfillIndex = migration.indexOf('SET prospect_id = prospect_id')
    expect(triggerIndex).toBeGreaterThan(-1)
    expect(backfillIndex).toBeGreaterThan(triggerIndex)
  })
})
