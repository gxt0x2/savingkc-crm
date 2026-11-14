import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeParcelId, zip5 } from '@/lib/market-check/address'
import type { PoolRowInput } from '@/lib/market-check/plan'
import type { TargetZipStatus } from '@/lib/market-check/seeds'

type Row = Record<string, unknown>

async function pages(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await read(from, from + 999)
    if (error) throw new Error(error.message || 'The calling pool could not be read.')
    const page = Array.isArray(data) ? data as Row[] : []
    rows.push(...page)
    if (page.length < 1000) break
  }
  return rows
}

export async function loadTargeting(db: SupabaseClient): Promise<{
  targetStatusByZip: Map<string, TargetZipStatus>
  minListPriceByZip: Map<string, number>
}> {
  const zips = await pages((from, to) => db.from('target_zips').select('zip5, status').range(from, to))
  const prices = await pages((from, to) => db.from('mls_price_thresholds').select('zip5, min_list_price').range(from, to))
  return {
    targetStatusByZip: new Map(zips.map((row) => [String(row.zip5), String(row.status) as TargetZipStatus])),
    minListPriceByZip: new Map(prices.map((row) => [String(row.zip5), Number(row.min_list_price)])),
  }
}

export async function loadCallingPool(db: SupabaseClient): Promise<PoolRowInput[]> {
  const pool = await pages((from, to) => db.from('source_list_rows')
    .select('id, list_type, parcel_id, address, state, prospect_id, status')
    .in('status', ['ready', 'loaded_to_dialer', 'new_needs_skip'])
    .range(from, to))
  const prospectIds = [...new Set(pool.map((row) => row.prospect_id).filter((id): id is string => typeof id === 'string'))]
  const prospects = new Map<string, Row>()
  for (let index = 0; index < prospectIds.length; index += 200) {
    const slice = prospectIds.slice(index, index + 200)
    const { data, error } = await db.from('prospects').select('id, owner_1, situs_zip, parcel_id').in('id', slice)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) prospects.set(String(row.id), row as Row)
  }
  const parcelIds = [...new Set(pool.flatMap((row) => {
    const raw = typeof row.parcel_id === 'string' ? row.parcel_id : ''
    return [raw, normalizeParcelId(raw)].filter(Boolean)
  }))]
  const roll = new Map<string, string>()
  for (let index = 0; index < parcelIds.length; index += 200) {
    const slice = parcelIds.slice(index, index + 200)
    const { data, error } = await db.from('parcel_inventory').select('parcel_id, owner_name').in('parcel_id', slice)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      const key = normalizeParcelId(String(row.parcel_id ?? ''))
      if (key && typeof row.owner_name === 'string') roll.set(key, row.owner_name)
    }
  }
  return pool.flatMap((row) => {
    if (typeof row.id !== 'string') return []
    const prospect = typeof row.prospect_id === 'string' ? prospects.get(row.prospect_id) : undefined
    const parcelId = normalizeParcelId(typeof row.parcel_id === 'string' ? row.parcel_id : '') || null
    const address = typeof row.address === 'string' ? row.address : null
    return [{
      id: row.id,
      listType: typeof row.list_type === 'string' ? row.list_type : '',
      parcelId,
      address,
      zip5: zip5(address) || zip5(typeof prospect?.situs_zip === 'string' ? prospect.situs_zip : ''),
      state: typeof row.state === 'string' ? row.state : null,
      prospectOwner: typeof prospect?.owner_1 === 'string' ? prospect.owner_1 : null,
      rollOwner: parcelId ? roll.get(parcelId) ?? null : null,
    }]
  })
}
