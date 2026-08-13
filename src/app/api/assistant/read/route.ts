import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeAssistantRequest } from '@/lib/assistant/auth'
import { ASSISTANT_ACTIVE_STAGES, cleanLeadSearch, crmLeadUrl } from '@/lib/assistant/read-model'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'private, no-store, max-age=0' }
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attention'), limit: z.number().int().min(1).max(20).optional() }),
  z.object({ action: z.literal('lead_search'), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(10).optional() }),
])

export async function POST(request: Request) {
  const identity = authorizeAssistantRequest(request)
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers })

  const db = supabaseAdmin()
  const generatedAt = new Date().toISOString()

  if (parsed.data.action === 'lead_search') {
    const query = cleanLeadSearch(parsed.data.query)
    if (!query) return NextResponse.json({ action: 'lead_search', generatedAt, records: [] }, { headers })

    const limit = parsed.data.limit ?? 6
    const pattern = `%${query}%`
    const selection = 'id, full_name, property_address, city, state, station, priority, source, updated_at'
    const [byName, byAddress] = await Promise.all([
      db.from('leads').select(selection).ilike('full_name', pattern).order('updated_at', { ascending: false }).limit(limit),
      db.from('leads').select(selection).ilike('property_address', pattern).order('updated_at', { ascending: false }).limit(limit),
    ])
    if (byName.error || byAddress.error) {
      console.error('[assistant-read] lead search failed', byName.error || byAddress.error)
      return NextResponse.json({ error: 'CRM lookup failed' }, { status: 500, headers })
    }

    const unique = new Map<string, Record<string, unknown>>()
    for (const row of [...(byName.data || []), ...(byAddress.data || [])]) unique.set(String(row.id), row)
    const records = Array.from(unique.values()).slice(0, limit).map((row) => ({ ...row, crmUrl: crmLeadUrl(String(row.id)) }))

    console.info('[assistant-read] completed', { action: 'lead_search', actor: identity.email, records: records.length })
    return NextResponse.json({ action: 'lead_search', generatedAt, query, records }, { headers })
  }

  const limit = parsed.data.limit ?? 10
  const now = new Date()
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const staleCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const [tasksResult, appointmentsResult, leadsResult] = await Promise.all([
    db.from('tasks').select('id, title, description, contact_id, due_date, assigned_to, status, type').in('status', ['pending', 'overdue']).order('due_date', { ascending: true, nullsFirst: false }).limit(limit),
    db.from('appointments').select('id, lead_id, scheduled_at, type, status, assigned_to').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', generatedAt).lte('scheduled_at', nextWeek).order('scheduled_at', { ascending: true }).limit(limit),
    db.from('leads').select('id, full_name, property_address, city, state, station, priority, updated_at').in('station', ASSISTANT_ACTIVE_STAGES).lt('updated_at', staleCutoff).order('updated_at', { ascending: true }).limit(limit),
  ])

  const missingLegacyTasks = tasksResult.error?.code === 'PGRST205' || tasksResult.error?.code === '42P01'
  if ((!missingLegacyTasks && tasksResult.error) || appointmentsResult.error || leadsResult.error) {
    console.error('[assistant-read] attention query failed', tasksResult.error || appointmentsResult.error || leadsResult.error)
    return NextResponse.json({ error: 'CRM attention query failed' }, { status: 500, headers })
  }

  const leadIds = new Set<string>()
  for (const task of missingLegacyTasks ? [] : (tasksResult.data || [])) if (task.contact_id) leadIds.add(String(task.contact_id))
  for (const appointment of appointmentsResult.data || []) if (appointment.lead_id) leadIds.add(String(appointment.lead_id))
  const related = leadIds.size
    ? await db.from('leads').select('id, full_name, property_address, station').in('id', Array.from(leadIds))
    : { data: [], error: null }
  if (related.error) return NextResponse.json({ error: 'CRM relationship query failed' }, { status: 500, headers })
  const leadById = new Map((related.data || []).map((lead) => [String(lead.id), lead]))

  const tasks = (missingLegacyTasks ? [] : (tasksResult.data || [])).map((task) => ({ ...task, lead: task.contact_id ? leadById.get(String(task.contact_id)) || null : null, crmUrl: task.contact_id ? crmLeadUrl(String(task.contact_id)) : null }))
  const appointments = (appointmentsResult.data || []).map((appointment) => ({ ...appointment, lead: appointment.lead_id ? leadById.get(String(appointment.lead_id)) || null : null, crmUrl: appointment.lead_id ? crmLeadUrl(String(appointment.lead_id)) : null }))
  const staleLeads = (leadsResult.data || []).map((lead) => ({ ...lead, crmUrl: crmLeadUrl(String(lead.id)) }))

  console.info('[assistant-read] completed', { action: 'attention', actor: identity.email, tasks: tasks.length, appointments: appointments.length, staleLeads: staleLeads.length })
  return NextResponse.json({ action: 'attention', generatedAt, tasks, appointments, staleLeads }, { headers })
}
