import { supabaseAdmin } from '@/lib/supabase/admin'

export interface BriefingRow {
  id: string
  lead_id: string
  situation: string | null
  motivation: string | null
  strategy: string | null
  generated_at: string
  generated_by: string
  generated_from: unknown
  is_current: boolean
  created_at: string
}

interface SaveBriefingInput {
  leadId: string
  situation?: string | null
  motivation?: string | null
  strategy?: string | null
  generatedFrom?: unknown
  generatedBy?: string
}

// Insert a new briefing row and demote any prior current briefing for the
// same lead. Keeps history without forcing readers to scan everything.
export async function saveBriefing(input: SaveBriefingInput): Promise<BriefingRow | null> {
  const db = supabaseAdmin()

  await db
    .from('briefings')
    .update({ is_current: false })
    .eq('lead_id', input.leadId)
    .eq('is_current', true)

  const { data, error } = await db
    .from('briefings')
    .insert({
      lead_id: input.leadId,
      situation: input.situation ?? null,
      motivation: input.motivation ?? null,
      strategy: input.strategy ?? null,
      generated_at: new Date().toISOString(),
      generated_by: input.generatedBy ?? 'system:ari',
      generated_from: input.generatedFrom ?? null,
      is_current: true,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[briefings] insert error:', error)
    return null
  }
  return data as BriefingRow
}

export async function getCurrentBriefing(leadId: string): Promise<BriefingRow | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('briefings')
    .select('*')
    .eq('lead_id', leadId)
    .eq('is_current', true)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as BriefingRow) ?? null
}
