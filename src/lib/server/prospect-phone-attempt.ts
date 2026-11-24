import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import type { DispositionId } from '@/lib/dialer-dispositions'

/**
 * Minimal Supabase surface this helper needs, so tests can inject a fake.
 */
interface QueryResult<T> { data: T | null; error: { message: string } | null }
export interface ProspectPhoneAttemptDb {
  from(table: 'prospects'): {
    select(cols: 'id'): { eq(col: 'lead_id', value: string): PromiseLike<QueryResult<Array<{ id: string }>>> }
  }
  from(table: 'prospect_phones'): {
    update(patch: Record<string, unknown>): {
      in(col: 'prospect_id', values: string[]): {
        eq(col: 'phone', value: string): {
          select(cols: 'id'): PromiseLike<QueryResult<Array<{ id: string }>>>
        }
      }
    }
  }
}

/**
 * Lead-path dispositions (POST /api/leads/:id/disposition) used to record the
 * call on lead_activities but never touch prospect_phones, so a phone dialed
 * from a Lead (rather than the heir queue) kept attempted=false after
 * no_answer and stayed "uncalled" in Prospecting (Pelton …0570, Nov 2).
 *
 * Marks every prospect_phones row for this lead whose number matches the
 * dialed phone as attempted. Best-effort: never throws, returns the ids it
 * updated so callers/tests can see the effect.
 */
export async function markLeadProspectPhoneAttempted(
  db: ProspectPhoneAttemptDb,
  input: { leadId: string; phone: string | null; disposition: DispositionId; actorName: string; now?: string },
): Promise<string[]> {
  const e164 = normalizePhoneToE164(input.phone ?? '')
  if (!e164) return []
  try {
    const prospects = await db.from('prospects').select('id').eq('lead_id', input.leadId)
    if (prospects.error || !prospects.data?.length) return []
    const ids = prospects.data.map((row) => row.id)
    const updated = await db.from('prospect_phones')
      .update({
        attempted: true,
        last_disposition: input.disposition,
        last_attempt_at: input.now ?? new Date().toISOString(),
        last_attempt_by: input.actorName,
      })
      .in('prospect_id', ids)
      .eq('phone', e164)
      .select('id')
    if (updated.error) {
      console.error('[lead disposition] prospect phone attempt mark failed:', updated.error.message)
      return []
    }
    return (updated.data ?? []).map((row) => row.id)
  } catch (error) {
    console.error('[lead disposition] prospect phone attempt mark failed:', error)
    return []
  }
}
