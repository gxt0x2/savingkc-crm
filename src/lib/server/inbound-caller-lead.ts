/**
 * Serialized "create the bare missed-call lead" step.
 *
 * Calls claim_inbound_caller_lead (advisory lock per phone) so two Twilio
 * callbacks for the same caller arriving together produce one lead. If the
 * migration is not applied yet, falls back to re-checking then inserting,
 * which is the previous behavior.
 */
interface RpcResult { data: unknown; error: { message?: string; code?: string } | null }
export interface InboundCallerLeadDb {
  rpc(fn: 'claim_inbound_caller_lead', args: { p_phone: string; p_full_name: string; p_priority: string }): PromiseLike<RpcResult>
  from(table: 'leads'): {
    select(cols: 'id'): { eq(col: 'phone', v: string): { order(c: 'created_at', o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }> } } }
    insert(row: Record<string, unknown>): { select(cols: 'id'): { single(): PromiseLike<{ data: { id: string } | null; error: unknown }> } }
  }
}

export function isMissingRpc(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const raw = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase()
  return raw.includes('pgrst202') || raw.includes('42883') || raw.includes('could not find the function')
}

export async function claimInboundCallerLead(
  db: InboundCallerLeadDb,
  input: { phone: string; fullName: string; priority?: string },
): Promise<{ leadId: string | null; created: boolean }> {
  const priority = input.priority ?? 'hot'
  const rpc = await db.rpc('claim_inbound_caller_lead', { p_phone: input.phone, p_full_name: input.fullName, p_priority: priority })
  if (!rpc.error) {
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { lead_id?: string; created?: boolean } | null
    return { leadId: row?.lead_id ?? null, created: Boolean(row?.created) }
  }
  if (!isMissingRpc(rpc.error)) {
    console.error('[inbound caller lead] claim failed:', rpc.error.message)
    return { leadId: null, created: false }
  }

  // Legacy path until the migration is applied.
  const existing = await db.from('leads').select('id').eq('phone', input.phone).order('created_at', { ascending: false }).limit(1)
  const existingId = existing.data?.[0]?.id
  if (existingId) return { leadId: existingId, created: false }
  const inserted = await db.from('leads').insert({
    full_name: input.fullName, phone: input.phone, source: 'inbound_call', station: 'new', priority,
  }).select('id').single()
  return { leadId: inserted.data?.id ?? null, created: Boolean(inserted.data?.id) }
}
