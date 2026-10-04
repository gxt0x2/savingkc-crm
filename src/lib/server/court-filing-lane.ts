import { ForeclosureError } from '@/lib/server/foreclosure-prospects'
import { presentFilingLane, type FilingLane, type FilingLaneView } from '@/lib/prospecting/court-filing-source'
import { supabase } from '@/lib/supabase-lazy'

const DIVORCE_TABLE = 'court_filings'
const LIEN_TABLE = 'recorder_liens'

export async function listFilingLane(lane: FilingLane): Promise<FilingLaneView> {
  const table = lane === 'divorce' ? DIVORCE_TABLE : LIEN_TABLE
  const columns = lane === 'divorce'
    ? 'id,county,state,filing_kind,party_name,situs,case_number,filed_on,source_name,dialer_enrolled'
    : 'id,county,state,lien_kind,debtor_name,situs,instrument_number,recorded_on,source_name,dialer_enrolled'
  const { data, error } = await supabase.from(table).select(columns).in('county', ['jackson', 'johnson']).limit(200)
  if (error) {
    const detail = `${error.message || ''} ${error.code || ''}`.toLowerCase()
    if (detail.includes('42p01') || detail.includes('does not exist') || detail.includes('pgrst205')) {
      return presentFilingLane(lane, [], true)
    }
    throw new ForeclosureError('foreclosure_unavailable', 503, 'Filing rows could not be read.')
  }
  return presentFilingLane(lane, (data ?? []) as Array<Record<string, unknown>>)
}
