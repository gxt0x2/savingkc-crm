import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDialerQueueLeadIds } from '@/lib/server/dialer-queue-route'

const routeSource = readFileSync('src/app/api/dialer/queue/route.ts', 'utf8')
const pageSource = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')
const projectionSource = readFileSync('supabase/migrations/20260905120000_dialer_queue_read_model.sql', 'utf8')

describe('dialer queue safety filtering', () => {
  it('keeps only unique UUIDs from an explicit session request', () => {
    expect(parseDialerQueueLeadIds('not-an-id,00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000001')).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ])
    expect(parseDialerQueueLeadIds('not-an-id')).toEqual([])
  })

  it('enforces terminal, invalid-phone, and global suppression rules in the queue projection', () => {
    expect(projectionSource).toContain("NOT IN ('dead', 'closed_lost')")
    expect(projectionSource).toContain("<> 'dead'")
    expect(projectionSource).toContain('normalize_conversation_phone(lead.phone) IS NOT NULL')
    expect(projectionSource).toContain('FROM public.sms_opt_outs AS opt_out')
    expect(projectionSource).toContain('opt_out.is_opted_out = TRUE')
  })

  it('uses the bounded projection and returns a compact queue contract', () => {
    expect(routeSource).toContain('readDialerQueuePage({')
    expect(routeSource).toContain('queueContext: page.queueContext')
    expect(routeSource).toContain('queueMetrics: page.queueMetrics')
    expect(routeSource).toContain("'Server-Timing'")
    expect(routeSource).not.toContain(".from('sms_opt_outs')")
    expect(routeSource).not.toContain(".from('lead_activities')")
    expect(routeSource).not.toContain('buildDialerQueueContext')
    expect(pageSource).not.toContain('QueueContactActivity')
    expect(pageSource).not.toContain('QueueFollowup')
  })
})
