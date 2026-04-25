import { supabaseAdmin } from '@/lib/supabase/admin'

export interface CoOwnerRow {
  id: string
  lead_id: string
  name: string
  relationship: string | null
  phone: string | null
  email: string | null
  source: 'ai_extraction' | 'manual' | 'county_records'
  created_at: string
  updated_at: string
}

interface SyncInput {
  leadId: string
  names: string[]
  source?: 'ai_extraction' | 'manual' | 'county_records'
}

// Insert any co-owner names that aren't already on file for this lead.
// We don't delete on purpose — call analysis can be incomplete and we don't
// want a single missed mention to drop someone we previously identified.
export async function syncCoOwners({ leadId, names, source = 'ai_extraction' }: SyncInput): Promise<void> {
  const cleaned = Array.from(
    new Set(
      names
        .map(n => (typeof n === 'string' ? n.trim() : ''))
        .filter(n => n.length > 1)
    )
  )
  if (cleaned.length === 0) return

  const db = supabaseAdmin()
  const rows = cleaned.map(name => ({ lead_id: leadId, name, source }))
  const { error } = await db
    .from('lead_co_owners')
    .upsert(rows, { onConflict: 'lead_id,name', ignoreDuplicates: true })
  if (error) {
    console.error('[co-owners] upsert error:', error)
  }
}

export async function getCoOwners(leadId: string): Promise<CoOwnerRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('lead_co_owners')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
  return (data as CoOwnerRow[]) ?? []
}
