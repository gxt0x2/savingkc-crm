import { mojoCallIngestHealth } from './mojo-dial-outcome'
import { MOJO_CALL_INGEST_OK_KEY } from './mojo-dial-ingest'

export type MojoCallIngestHealthReport = {
  status: 'current' | 'stale' | 'unknown'
  stale: boolean
  lastSuccessAt: string | null
  latestCallAt: string | null
  ageHours: number | null
  message: string
}

// Supabase's query builder is generic enough that a precise structural type
// makes `tsc` hit "excessively deep" instantiation at the call site.
// The chains below are the only surface this reader uses.
export type MojoDialHealthDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export async function readMojoCallIngestHealth(
  db: MojoDialHealthDb,
  now = new Date(),
): Promise<MojoCallIngestHealthReport> {
  try {
    const [config, latest] = await Promise.all([
      db.from('system_config').select('value').eq('key', MOJO_CALL_INGEST_OK_KEY).maybeSingle(),
      db.from('crm_mojo_calls').select('call_at').order('call_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (config.error || latest.error) {
      return {
        status: 'unknown',
        stale: false,
        lastSuccessAt: null,
        latestCallAt: null,
        ageHours: null,
        message: 'Mojo call ingest health could not be read.',
      }
    }
    return mojoCallIngestHealth({
      lastSuccessAt: textValue(config.data?.value),
      latestCallAt: textValue(latest.data?.call_at),
      now,
    })
  } catch {
    return {
      status: 'unknown',
      stale: false,
      lastSuccessAt: null,
      latestCallAt: null,
      ageHours: null,
      message: 'Mojo call ingest health could not be read.',
    }
  }
}
