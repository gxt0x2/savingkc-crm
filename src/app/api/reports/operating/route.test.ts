import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type QueryCall = { table: string; method: string; args: unknown[] }

const queryCalls: QueryCall[] = []
const datasets: Record<string, unknown[]> = {
  leads: [{
    id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Seller One',
    phone: '+18165550100',
    email: null,
    property_address: '1 Main St',
    city: 'Kansas City',
    source: 'website',
    station: 'qualified',
    priority: null,
    assigned_agent: 'Casey',
    opportunity_score: 70,
    motivation_score: null,
    arv: null,
    offer_amount: null,
    classification: 'lead',
    dead_reason: null,
    is_favorite: false,
    created_at: '2026-08-10T12:00:00.000Z',
    is_parked: false,
  }],
  lead_activities: [{
    id: 'activity-1',
    lead_id: '11111111-1111-4111-8111-111111111111',
    activity_type: 'call',
    description: 'Outbound call connected',
    agent: 'Casey',
    metadata: { direction: 'outbound', outcome: 'connected' },
    created_at: '2026-08-10T12:05:00.000Z',
  }],
  appointments: [],
  dispo_deals: [],
  buyers: [],
  revenue_transactions: [],
  expense_transactions: [],
  roles: [],
  buyer_offers: [],
  conversation_thread_state: [{
    lead_id: '11111111-1111-4111-8111-111111111111',
    attention_state: 'needs_reply',
    owner: 'Casey',
    last_activity_at: '2026-08-10T12:05:00.000Z',
    primary_next_action_id: null,
    primary_next_action_due_at: null,
  }],
}

function queryFor(table: string) {
  const query = {
    select(...args: unknown[]) { queryCalls.push({ table, method: 'select', args }); return query },
    eq(...args: unknown[]) { queryCalls.push({ table, method: 'eq', args }); return query },
    lte(...args: unknown[]) { queryCalls.push({ table, method: 'lte', args }); return query },
    gte(...args: unknown[]) { queryCalls.push({ table, method: 'gte', args }); return query },
    order(...args: unknown[]) { queryCalls.push({ table, method: 'order', args }); return query },
    limit(...args: unknown[]) { queryCalls.push({ table, method: 'limit', args }); return query },
    or(...args: unknown[]) { queryCalls.push({ table, method: 'or', args }); return query },
    in(...args: unknown[]) { queryCalls.push({ table, method: 'in', args }); return query },
    then(resolve: (value: { data: unknown[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ data: datasets[table] ?? [], error: null }).then(resolve, reject)
    },
  }
  return query
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => queryFor(table) }),
}))

describe('GET /api/reports/operating', () => {
  beforeEach(() => queryCalls.splice(0))

  it('loads a period-bounded report and takes attention from the conversation projection', async () => {
    const { GET } = await import('./route')
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/reports/operating?period=30d'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('server-timing')).toContain('activities')
    expect(payload.core).toMatchObject({ leads: 1, qualified: 1, needsReply: 1 })
    expect(payload.communications).toMatchObject({ calls: 1, connectedCalls: 1 })
    expect(payload.availability).toMatchObject({ leads: true, conversations: true, activityComplete: true })

    expect(queryCalls).toContainEqual(expect.objectContaining({ table: 'leads', method: 'gte', args: ['created_at', expect.any(String)] }))
    expect(queryCalls).toContainEqual(expect.objectContaining({ table: 'lead_activities', method: 'gte', args: ['created_at', expect.any(String)] }))
    expect(queryCalls.some((call) => call.table === 'conversation_thread_state' && call.method === 'select')).toBe(true)
    expect(queryCalls.some((call) => call.method === 'limit' && call.args[0] === 20_001)).toBe(true)
  })
})
