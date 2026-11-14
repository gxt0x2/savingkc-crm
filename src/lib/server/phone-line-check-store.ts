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
    async selectCandidates(input): Promise<LineCheckSelection> {
      const { data, error } = await db.rpc('select_phone_line_check_candidates_v1', {
        p_limit: input.limit,
        p_source_list_id: input.sourceListId,
        p_prospect_phone_ids: input.prospectPhoneIds,
      })
      if (error) throw new Error(error.message)
      return parseLineCheckSelection(data)
    },
    async applyChecks(input: {
      results: LineCheckWrite[]
      source: 'cron' | 'manual'
      actor: string
      reportCap: boolean
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
      })
      if (error) throw new Error(error.message)
      return parseLineCheckApplyResult(data)
    },
  }
}
