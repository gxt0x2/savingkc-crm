// POST /api/sms/bulk — text many leads at once with one (optionally templated)
// message. Reuses sendLeadSms per recipient so opt-out, 24h de-dupe, smart
// from-number, logging, and pipeline auto-advance behave exactly like a single
// send. Each send lands in the lead's Communication Hub.
//
// Body: { leadIds: string[], templateName?: string, body?: string,
//         fromPhone?: string, agent?: string, force?: boolean }
//
// NOTE (compliance): texting hours are enforced as Mon–Sat 9am–7pm Central to
// match the automated worker. Heirs span timezones, so for strict TCPA quiet
// hours we'd need per-lead timezone — see roadmap. `force` (admin) bypasses.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { getTemplate, resolveTemplate, incrementUsage } from '@/lib/sms-templates'
import { BULK_SMS_MAX, isWithinTextingHours, summarizeBulkSms, describeBulkResult, type BulkSmsItem } from '@/lib/bulk-sms'

export const maxDuration = 60

const CONCURRENCY = 8

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
}

export async function POST(req: Request) {
  try {
    const { leadIds, templateName, body, fromPhone, agent, force } = await req.json()

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds (non-empty array) is required' }, { status: 400 })
    }
    const ids: string[] = [...new Set(leadIds.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid lead IDs' }, { status: 400 })
    }
    if (ids.length > BULK_SMS_MAX) {
      return NextResponse.json({ error: `Too many recipients (${ids.length}). Max ${BULK_SMS_MAX} per send.` }, { status: 400 })
    }
    if (!templateName && !body?.trim()) {
      return NextResponse.json({ error: 'Provide a templateName or a message body' }, { status: 400 })
    }
    if (!force && !isWithinTextingHours()) {
      return NextResponse.json({ error: 'Outside texting hours (Mon–Sat 9am–7pm CT)' }, { status: 422 })
    }

    // Resolve the message template (falls back to the raw body).
    let baseBody = body?.trim() || ''
    if (templateName) {
      const tpl = await getTemplate(templateName)
      if (!tpl) return NextResponse.json({ error: `Template "${templateName}" not found` }, { status: 404 })
      baseBody = tpl.body
    }

    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, property_address')
      .in('id', ids)
    const byId = new Map<string, LeadRow>((leads as LeadRow[] | null ?? []).map((l) => [l.id, l]))

    // Send with bounded concurrency so a large batch doesn't serialize into a
    // timeout or hammer Twilio all at once.
    const items: BulkSmsItem[] = []
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY)
      const settled = await Promise.all(chunk.map(async (leadId): Promise<BulkSmsItem> => {
        const lead = byId.get(leadId)
        if (!lead) return { leadId, status: 'skipped', reason: 'not_found' }
        if (!lead.phone) return { leadId, status: 'skipped', reason: 'no_phone' }

        const text = resolveTemplate(baseBody, { full_name: lead.full_name, property_address: lead.property_address })
        const r = await sendLeadSms({ leadId, phone: lead.phone, body: text, fromPhone, agent })
        if (r.status === 'sent') return { leadId, status: 'sent' }
        if (r.status === 'failed') return { leadId, status: 'failed', error: r.error }
        return { leadId, status: 'skipped', reason: r.reason }
      }))
      items.push(...settled)
    }

    const summary = summarizeBulkSms(items)
    if (templateName && summary.sent > 0) {
      incrementUsage(templateName).catch((err) => console.error('[BULK-SMS] usage increment failed:', err))
    }

    return NextResponse.json({ ok: true, summary, message: describeBulkResult(summary), results: items })
  } catch (err) {
    console.error('[BULK-SMS] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
