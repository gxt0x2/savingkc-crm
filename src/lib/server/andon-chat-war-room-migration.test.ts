import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261026120000_andon_chat_war_room.sql'),
  'utf8',
)

describe('Andon Chat war room migration', () => {
  it('adds Chat identifiers and notes on feedback_submissions only', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS chat_space_id TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS chat_thread_id TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS notes JSONB')
    expect(migration).not.toMatch(/ALTER TABLE public\.leads/)
    expect(migration).not.toMatch(/mojo_call_queue/)
  })
})
