import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseLineCheckApplyResult,
  parseLineCheckSelection,
  type LineCheckApplyResult,
  type LineCheckSelection,
  type LineCheckWrite,
  type PhoneLineCheckStore,
} from '@/lib/server/phone-line-check'

type RpcClient = Pick<SupabaseClient, 'rpc'>

export function phoneLineCheckStore(db: RpcClient): PhoneLineCheckStore {
  return {
    async syncConfig(input) {
      const { error } = await db.rpc('sync_phone_line_check_config_v1', {
        p_block_enabled: input.blockEnabled,
        p_cost_usd: input.costUsd,
      })
      if (error) throw new Error(error.message)
    },
    async reserveCandidates(input): Promise<LineCheckSelection> {
      const { data, error } = await db.rpc('reserve_phone_line_check_candidates_v1', {
        p_limit: input.limit,
        p_source_list_id: input.sourceListId,
        p_prospect_phone_ids: input.prospectPhoneIds,
        p_fresh_reserve_usd: input.freshReserveUsd,
        p_source: input.source,
        p_actor: input.actor,
      })
      if (error) throw new Error(error.message)
      return parseLineCheckSelection(data)
    },
    async applyChecks(input: {
      results: LineCheckWrite[]
      source: 'cron' | 'manual'
      actor: string
      reportCap: boolean
      suppressOnly: boolean
    }): Promise<LineCheckApplyResult> {
      const { data, error } = await db.rpc('apply_phone_line_checks_v1', {
        p_results: input.results.map((result) => ({
          phone_e164: result.phoneE164,
          line_type: result.lineType,
          line_status: result.lineStatus,
          failed: result.failed,
          raw: result.raw,
          checked_at: result.checkedAt,
        })),
        p_source: input.source,
        p_actor: input.actor,
        p_report_cap: input.reportCap,
        p_suppress_only: input.suppressOnly,
      })
      if (error) throw new Error(error.message)
      return parseLineCheckApplyResult(data)
    },
  }
}
