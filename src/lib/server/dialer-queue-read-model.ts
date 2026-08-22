import type { DialerQueueContextRow, DialerQueueMetrics } from '@/lib/dialer-queue-contract'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface DialerQueueDatabase {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

interface DialerQueueRpcRow {
  leads?: unknown
  queue_context?: unknown
  prospects?: unknown
  queue_metrics?: unknown
  total_count?: unknown
}

export interface DialerQueuePage {
  leads: Record<string, unknown>[]
  queueContext: DialerQueueContextRow[]
  prospects: Record<string, unknown>[]
  queueMetrics: DialerQueueMetrics
  totalCount: number
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

export async function readDialerQueuePage(
  input: { limit: number; leadIds?: string[]; referenceTime?: string },
  db: DialerQueueDatabase = supabaseAdmin(),
): Promise<DialerQueuePage> {
  const { data, error } = await db.rpc('dialer_queue_page_v1', {
    target_limit: Math.min(Math.max(Math.floor(input.limit) || 1000, 1), 1000),
    target_lead_ids: input.leadIds?.length ? input.leadIds : null,
    reference_time: input.referenceTime ?? new Date().toISOString(),
  })
  if (error) {
    console.error('Dialer queue projection query failed', { message: error.message })
    throw new Error('Dialer queue could not be loaded')
  }

  const row = (Array.isArray(data) ? data[0] : data) as DialerQueueRpcRow | null
  const metrics = row?.queue_metrics && typeof row.queue_metrics === 'object' && !Array.isArray(row.queue_metrics)
    ? row.queue_metrics as Record<string, unknown>
    : {}
  return {
    leads: objectArray(row?.leads),
    queueContext: objectArray(row?.queue_context) as unknown as DialerQueueContextRow[],
    prospects: objectArray(row?.prospects),
    queueMetrics: {
      callsToday: Number(metrics.callsToday) || 0,
      uniqueLeadsToday: Number(metrics.uniqueLeadsToday) || 0,
    },
    totalCount: Number(row?.total_count) || 0,
  }
}
