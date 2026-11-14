import type { SupabaseClient } from '@supabase/supabase-js'
import { writeMarketPlan, type MarketWriteClient, type MarketWriteResult } from '@/lib/market-check/apply'
import { fileSha256, parseMatrixCsv } from '@/lib/market-check/matrix-csv'
import { planMarketCheck } from '@/lib/market-check/plan'
import { loadCallingPool, loadTargeting } from '@/lib/market-check/pool'
import { additionListDay, chicagoClock, offMarketAllowed } from '@/lib/market-check/schedule'
import { explicitEnvFlag } from '@/lib/market-check/flags'

export async function syncMarketFlags(db: SupabaseClient): Promise<void> {
  const enabled = explicitEnvFlag('MLS_MARKET_CHECK_ENABLED')
  const confirmed = explicitEnvFlag('EXPIRED_OWNER_CONFIRMED')
  if (enabled === null && confirmed === null) return
  const { error } = await db.rpc('sync_mls_market_flags_v1', {
    p_market_check_enabled: enabled === null ? null : String(enabled),
    p_expired_owner_confirmed: confirmed === null ? null : String(confirmed),
  })
  if (error) throw new Error(error.message)
}

export async function runMatrixLoad(
  db: SupabaseClient,
  input: { csvText: string; fileName: string; actor: string; now?: Date },
): Promise<MarketWriteResult> {
  const now = input.now ?? new Date()
  const clock = chicagoClock(now)
  const rows = parseMatrixCsv(input.csvText)
  const targeting = await loadTargeting(db)
  const poolRows = await loadCallingPool(db)
  const plan = planMarketCheck({
    rows,
    poolRows,
    targetStatusByZip: targeting.targetStatusByZip,
    minListPriceByZip: targeting.minListPriceByZip,
    today: clock.date,
    additionListDay: additionListDay(now),
    allowOffMarket: offMarketAllowed(now),
    fileSha256: fileSha256(input.csvText),
  })
  return writeMarketPlan(db as unknown as MarketWriteClient, plan, input.actor, {
    sha256: fileSha256(input.csvText),
    bytes: Buffer.byteLength(input.csvText),
    name: input.fileName,
    pullDate: clock.date,
  })
}
