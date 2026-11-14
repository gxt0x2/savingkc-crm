import type { MarketPlan } from '@/lib/market-check/plan'

export interface MarketWriteResult {
  checks: number
  tags: number
  intakes: number
  coveredZips: string[]
}

export async function writeMarketPlan(
  db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> },
  plan: MarketPlan,
  actor: string,
  file: { sha256: string; bytes: number; name: string; pullDate: string },
): Promise<MarketWriteResult> {
  const result = await db.rpc('apply_market_plan_v1', {
    p_plan: {
      actor,
      sha256: file.sha256,
      bytes: file.bytes,
      fileName: file.name,
      pullDate: file.pullDate,
      coveredZips: plan.coveredZips,
      checks: plan.checks,
      tags: plan.tags,
      intakes: plan.intakes,
    },
  })
  if (result.error) throw new Error(result.error.message || 'The market plan could not be saved.')
  const payload = (result.data ?? {}) as { checks?: number; intakes?: number }
  return {
    checks: payload.checks ?? plan.checks.length,
    tags: plan.tags.length,
    intakes: payload.intakes ?? plan.intakes.length,
    coveredZips: plan.coveredZips,
  }
}
