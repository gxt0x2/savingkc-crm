import type { OperatingReport } from '@/lib/operating-report'

export const ACQUISITION_SOURCE_CHANNELS = [
  { key: 'google_general', label: 'Google - General' },
  { key: 'google_tax_delinquent', label: 'Google - Tax' },
  { key: 'cold_calls', label: 'Cold Calls' },
  { key: 'sms_outreach', label: 'Cold SMS' },
  { key: 'youtube', label: 'YouTube' },
] as const

export type AcquisitionSourceChannel = (typeof ACQUISITION_SOURCE_CHANNELS)[number]['key']
type OperatingSourceRow = OperatingReport['marketing']['sources'][number]

export interface AcquisitionSourceRow {
  key: AcquisitionSourceChannel
  label: string
  leads: number
  qualified: number
  appointments: number
  contracts: number
  revenue: number
}

export function buildAcquisitionSourceRows(sourceRows: OperatingSourceRow[]): AcquisitionSourceRow[] {
  const rows = new Map<AcquisitionSourceChannel, AcquisitionSourceRow>(
    ACQUISITION_SOURCE_CHANNELS.map((channel) => [channel.key, {
      ...channel,
      leads: 0,
      qualified: 0,
      appointments: 0,
      contracts: 0,
      revenue: 0,
    }]),
  )

  for (const sourceRow of sourceRows) {
    const channel = acquisitionSourceChannel(sourceRow.source)
    if (!channel) continue
    const row = rows.get(channel)!
    row.leads += sourceRow.leads
    row.qualified += sourceRow.qualified
    row.appointments += sourceRow.appointments
    row.contracts += sourceRow.contracts
    row.revenue += sourceRow.revenue
  }

  return ACQUISITION_SOURCE_CHANNELS.map(({ key }) => rows.get(key)!)
}

function acquisitionSourceChannel(source: string): AcquisitionSourceChannel | null {
  const value = source.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (/(tax_?delinquent|delinquent_?tax|ppc_?tax|tax_?ppc)/.test(value)) return 'google_tax_delinquent'
  if (/google_?ads|googleads|gclid|paid_?search|(^|_)ppc(_|$)/.test(value)) return 'google_general'
  if (/youtube|you_?tube/.test(value)) return 'youtube'
  if (/outbound|cold_?call|mojo|dialer/.test(value)) return 'cold_calls'
  if (/(sms|text)/.test(value)) return 'sms_outreach'
  return null
}
