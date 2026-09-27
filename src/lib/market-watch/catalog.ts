import august2026 from '@/data/wholesale-market/august-2026.json'

import { mergeWholesaleMarketSnapshots, parseWholesaleMarketSnapshot, type WholesaleMarketSnapshot } from './snapshot'

const bundledSnapshots = [parseWholesaleMarketSnapshot(august2026)]

export function bundledWholesaleMarketSnapshots(): WholesaleMarketSnapshot[] {
  return bundledSnapshots
}

export async function loadWholesaleMarketCatalog(): Promise<WholesaleMarketSnapshot[]> {
  return mergeWholesaleMarketSnapshots(bundledSnapshots, await readStoredSnapshots())
}

async function readStoredSnapshots(): Promise<WholesaleMarketSnapshot[]> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { data, error } = await supabaseAdmin()
      .from('wholesale_market_snapshots')
      .select('payload')
      .order('month_key', { ascending: false })
    if (error || !data) return []
    const stored: WholesaleMarketSnapshot[] = []
    for (const row of data) {
      try {
        stored.push(parseWholesaleMarketSnapshot(row.payload))
      } catch {
        // A corrupt row must not hide the bundled month or other valid snapshots.
      }
    }
    return stored
  } catch {
    return []
  }
}
