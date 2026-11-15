import type { SupabaseClient } from '@supabase/supabase-js'
import { writeMarketPlan, type MarketWriteResult } from '@/lib/market-check/apply'
import { fileSha256, matrixCsvHasExpireColumn, parseMatrixCsv } from '@/lib/market-check/matrix-csv'
import { planMarketCheck } from '@/lib/market-check/plan'
import { loadCallingPool, loadTargeting } from '@/lib/market-check/pool'
import { additionListDay, chicagoClock, offMarketAllowed } from '@/lib/market-check/schedule'
import { explicitEnvFlag } from '@/lib/market-check/flags'
import { marketSeedPayload } from '@/lib/market-check/seeds'

export async function syncMarketFlags(db: SupabaseClient): Promise<void> {
  const enabled = explicitEnvFlag('MLS_MARKET_CHECK_ENABLED')
  const confirmed = explicitEnvFlag('EXPIRED_OWNER_CONFIRMED')
  if (enabled !== false && confirmed !== false) return
  const { error } = await db.rpc('sync_mls_market_flags_v1', {
    p_market_check_enabled: enabled === false ? 'false' : null,
    p_expired_owner_confirmed: confirmed === false ? 'false' : null,
  })
  if (error) throw new Error(error.message)
}

export async function runMatrixLoad(
  db: SupabaseClient,
  input: { csvText: string; fileName: string; actor: string; now?: Date; completeSet?: boolean; parts?: string[] },
): Promise<MarketWriteResult> {
  const seeded = await db.rpc('apply_market_seeds_v1', { p_seeds: marketSeedPayload() })
  if (seeded.error) throw new Error(seeded.error.message)
  const now = input.now ?? new Date()
  const clock = chicagoClock(now)
  const rows = parseMatrixCsv(input.csvText)
  const targeting = await loadTargeting(db)
  const poolRows = await loadCallingPool(db)
  const flag = await db.from('mls_market_config').select('value').eq('key', 'MLS_MARKET_CHECK_ENABLED').maybeSingle()
  const marketOn = flag.data?.value === 'true'
  const completeFile = input.completeSet === true
  const plan = planMarketCheck({
    rows,
    poolRows,
    targetStatusByZip: targeting.targetStatusByZip,
    minListPriceByZip: targeting.minListPriceByZip,
    today: clock.date,
    additionListDay: additionListDay(now),
    allowOffMarket: offMarketAllowed(now),
    completeFile,
    hasExpireColumn: matrixCsvHasExpireColumn(input.csvText),
    fileSha256: fileSha256(input.csvText),
  })
  plan.complete = completeFile
  plan.parts = input.parts ?? []
  if (!marketOn) {
    plan.tags = []
    plan.intakes = []
  }
  return writeMarketPlan(db, plan, input.actor, {
    sha256: fileSha256(input.csvText),
    bytes: Buffer.byteLength(input.csvText),
    name: input.fileName,
    pullDate: clock.date,
  })
}
