import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

type DialerCompatibilityParams = Record<string, string | string[] | undefined>

const FORWARDED_DIALER_PARAMS = [
  'session_id',
  'campaign',
  'lead_ids',
  'cohort',
  'caller_id',
  'caller_mode',
  'rotation_every',
  'rotation_numbers',
  'redial_caller_id',
  'queue_label',
  'call_hammer',
  'ring_count',
  'start_index',
  'return_to',
] as const

export default async function DialerCompatibilityPage({ searchParams }: { searchParams: Promise<DialerCompatibilityParams> }) {
  const incoming = await searchParams
  const outgoing = new URLSearchParams()

  for (const key of FORWARDED_DIALER_PARAMS) {
    const value = incoming[key]
    const first = Array.isArray(value) ? value[0] : value
    if (typeof first === 'string' && first.trim()) outgoing.set(key, first.trim())
  }

  const query = outgoing.toString()
  redirect(query ? `/prospecting?${query}` : '/prospecting')
}
