import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261022120000_crm_deal_ledger_lines.sql'),
  'utf8',
)

describe('Deal File ledger migration contract', () => {
  it('creates an append-only money table keyed to a deal', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_deal_ledger_lines')
    expect(migration).toContain('amount numeric(12, 2) NOT NULL')
    expect(migration).toContain("direction text NOT NULL CHECK (direction IN ('in', 'out'))")
    expect(migration).toContain('posted_on date NOT NULL')
    expect(migration).toContain('source text NOT NULL')
    expect(migration).toContain("'assignment_fee'")
    expect(migration).toContain("'transaction_fee'")
    expect(migration).toContain("'emd'")
    expect(migration).toContain("'overhead'")
    expect(migration).toContain("'other'")
    expect(migration).toContain('lead_id uuid NOT NULL REFERENCES public.leads(id)')
    expect(migration).toContain('file_number text')
    expect(migration).toContain('created_at timestamptz NOT NULL DEFAULT now()')
    expect(migration).toContain('UNIQUE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_identity')
    expect(migration).toContain('(source, category, direction)')
  })

  it('keeps posted lines immutable and service-role only', () => {
    expect(migration).toContain('ALTER TABLE public.crm_deal_ledger_lines ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.crm_deal_ledger_lines TO service_role')
    expect(migration).not.toContain('GRANT UPDATE')
    expect(migration).not.toContain('GRANT DELETE')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.crm_deal_ledger_lines')
    expect(migration).toContain("RAISE EXCEPTION 'deal_ledger_immutable'")
    expect(migration).toContain("RAISE EXCEPTION 'ledger_line_conflict'")
    expect(migration).not.toMatch(/ON CONFLICT[\s\S]{0,80}DO UPDATE/i)
  })

  it('does not seed live bank data or touch Mojo queues', () => {
    expect(migration).not.toMatch(/96a9cd10-4b12-11f1-9150-33da0a1e0aa3/)
    expect(migration).not.toMatch(/20585/)
    expect(migration).not.toMatch(/mojo_call_queue/)
    expect(migration).not.toMatch(/CRON_SECRET/)
  })
})
