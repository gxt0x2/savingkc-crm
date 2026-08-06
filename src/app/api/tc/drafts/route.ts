export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logTcEvent } from '@/lib/tc'
import type { TcDraftRecipientRole, TcDraftStatus } from '@/types/dispo'
import { communicationTemplateById } from '@/lib/operating-model/communication-template-catalog'

const DRAFT_STATUSES = ['pending', 'approved', 'rejected', 'sending', 'sent', 'superseded'] as const

const createDraftSchema = z.object({
  tc_file_id: z.string().uuid(),
  template_id: z.string().uuid().optional(),
  channel: z.enum(['email', 'document', 'sms']).optional(),
  recipient_role: z.enum(['buyer', 'seller', 'title', 'internal']).optional(),
  recipient_email: z.string().nullable().optional(),
  recipient_phone: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  draft_body: z.string().min(1).optional(),
  created_by: z.string().min(1).optional(),
}).refine((data) => data.template_id || data.draft_body, {
  message: 'Provide template_id or draft_body',
})

interface LeadSnapshot {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  offer_amount: number | string | null
}

interface BuyerSnapshot {
  id: string
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

interface TcFileSnapshot {
  id: string
  lead_id: string
  file_number: string | null
  emd_due_at: string | null
  closing_scheduled_at: string | null
  assignment_fee: number | string | null
  lead: LeadSnapshot | null
  offer: {
    id: string
    offer_amount: number | string | null
    buyer: BuyerSnapshot | null
  } | null
  title_company: {
    id: string
    name: string
    office_phone: string | null
    office_email: string | null
  } | null
  title_contact: {
    id: string
    name: string
    role: string | null
    email: string | null
    phone: string | null
  } | null
}

interface TemplateSnapshot {
  id: string
  slug: string
  title: string
  template_type: 'email' | 'document' | 'checklist'
  audience: TcDraftRecipientRole
  subject: string | null
  body: string
}

function isDraftStatus(value: string): value is TcDraftStatus {
  return (DRAFT_STATUSES as readonly string[]).includes(value)
}

function formatCurrencyValue(value: number | string | null | undefined) {
  if (value == null || value === '') return ''
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

function formatDateValue(value: string | null | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] ?? ''
}

function renderTemplate(source: string, file: TcFileSnapshot) {
  const buyer = file.offer?.buyer
  const buyerDisplay = buyer?.name || buyer?.company || ''
  const values: Record<string, string> = {
    property_address: file.lead?.property_address ?? '',
    property_city: file.lead?.city ?? '',
    property_state: file.lead?.state ?? '',
    property_zip: file.lead?.zip ?? '',
    buyer_name: buyerDisplay,
    buyer_first_name: firstName(buyerDisplay),
    buyer_email: buyer?.email ?? '',
    buyer_phone: buyer?.phone ?? '',
    seller_name: file.lead?.full_name ?? '',
    seller_first_name: firstName(file.lead?.full_name),
    seller_phone: file.lead?.phone ?? '',
    seller_email: file.lead?.email ?? '',
    title_contact_name: file.title_contact?.name || file.title_company?.name || '',
    title_contact_role: file.title_contact?.role ?? '',
    title_contact_email: file.title_contact?.email || file.title_company?.office_email || '',
    title_contact_phone: file.title_contact?.phone || file.title_company?.office_phone || '',
    title_company_name: file.title_company?.name ?? '',
    title_company_email: file.title_company?.office_email ?? '',
    title_company_phone: file.title_company?.office_phone ?? '',
    file_number: file.file_number ?? '',
    emd_deadline: formatDateValue(file.emd_due_at),
    closing_date: formatDateValue(file.closing_scheduled_at),
    assignment_fee: formatCurrencyValue(file.assignment_fee),
    purchase_price: formatCurrencyValue(file.lead?.offer_amount),
    buyer_purchase_price: formatCurrencyValue(file.offer?.offer_amount),
  }

  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, token: string) => values[token] ?? match)
}

function recipientFor(role: TcDraftRecipientRole, file: TcFileSnapshot) {
  if (role === 'buyer') {
    return {
      email: file.offer?.buyer?.email ?? null,
      phone: file.offer?.buyer?.phone ?? null,
    }
  }
  if (role === 'title') {
    return {
      email: file.title_contact?.email || file.title_company?.office_email || null,
      phone: file.title_contact?.phone || file.title_company?.office_phone || null,
    }
  }
  if (role === 'seller') {
    return {
      email: file.lead?.email ?? null,
      phone: file.lead?.phone ?? null,
    }
  }
  return { email: null, phone: null }
}

async function loadFile(db: ReturnType<typeof supabaseAdmin>, tcFileId: string) {
  return db
    .from('tc_files')
    .select(
      `id, lead_id, file_number, emd_due_at, closing_scheduled_at, assignment_fee,
      lead:lead_id(id, full_name, phone, email, property_address, city, state, zip, offer_amount),
      offer:buyer_offer_id(id, offer_amount, buyer:buyer_id(id, name, company, email, phone)),
      title_company:title_company_id(id, name, office_phone, office_email),
      title_contact:title_contact_id(id, name, role, email, phone)`
    )
    .eq('id', tcFileId)
    .maybeSingle<TcFileSnapshot>()
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const tcFileId = searchParams.get('tc_file_id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200)

    if (status && status !== 'all' && !isDraftStatus(status)) {
      return NextResponse.json({ error: 'Invalid draft status' }, { status: 400 })
    }

    let query = supabaseAdmin()
      .from('tc_drafts')
      .select(
        `*,
        template:template_id(id, slug, title, template_type, audience, subject, body),
        file:tc_file_id(id, lead_id, status, file_number, emd_due_at, closing_scheduled_at, assignment_fee,
          lead:lead_id(id, full_name, phone, email, property_address, city, state, zip, offer_amount),
          offer:buyer_offer_id(id, offer_amount, buyer:buyer_id(id, name, company, email, phone)),
          title_company:title_company_id(id, name, office_phone, office_email),
          title_contact:title_contact_id(id, name, role, email, phone))`
      )
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (tcFileId) query = query.eq('tc_file_id', tcFileId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ drafts: data ?? [] })
  } catch (err) {
    console.error('[tc/drafts GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createDraftSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const db = supabaseAdmin()
    const input = parsed.data
    const catalogTemplate = input.template_id ? communicationTemplateById(input.template_id) : null

    if (input.template_id && !catalogTemplate) {
      const { data: existing, error: existingError } = await db
        .from('tc_drafts')
        .select('*')
        .eq('tc_file_id', input.tc_file_id)
        .eq('template_id', input.template_id)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
      if (existing) return NextResponse.json({ draft: existing, existing: true })
    }

    const [{ data: file, error: fileError }, { data: template, error: templateError }] = await Promise.all([
      loadFile(db, input.tc_file_id),
      input.template_id && !catalogTemplate
        ? db.from('tc_document_templates').select('id, slug, title, template_type, audience, subject, body').eq('id', input.template_id).maybeSingle<TemplateSnapshot>()
        : Promise.resolve({ data: catalogTemplate, error: null }),
    ])

    if (fileError) return NextResponse.json({ error: fileError.message }, { status: 500 })
    if (!file) return NextResponse.json({ error: 'TC file not found' }, { status: 404 })
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 })
    if (input.template_id && !template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    const recipientRole = input.recipient_role ?? template?.audience ?? 'internal'
    const recipient = recipientFor(recipientRole, file)
    const draftBody = input.draft_body ?? renderTemplate(template?.body ?? '', file)
    const subject = input.subject ?? (template?.subject ? renderTemplate(template.subject, file) : null)

    const { data: draft, error } = await db
      .from('tc_drafts')
      .insert({
        tc_file_id: file.id,
        template_id: catalogTemplate ? null : template?.id ?? null,
        lead_id: file.lead_id,
        channel: input.channel ?? (template?.template_type === 'document' ? 'document' : 'email'),
        recipient_role: recipientRole,
        recipient_email: input.recipient_email ?? recipient.email,
        recipient_phone: input.recipient_phone ?? recipient.phone,
        subject,
        draft_body: draftBody,
        created_by: input.created_by ?? 'system',
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505' && input.template_id) {
        const { data: existing } = await db
          .from('tc_drafts')
          .select('*')
          .eq('tc_file_id', input.tc_file_id)
          .eq('template_id', input.template_id)
          .eq('status', 'pending')
          .maybeSingle()
        if (existing) return NextResponse.json({ draft: existing, existing: true })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logTcEvent(db, file.id, 'draft_created', {
      draft_id: draft.id,
      template_id: template?.id ?? null,
      recipient_role: recipientRole,
    }, input.created_by ?? 'system')

    return NextResponse.json({
      draft: {
        ...draft,
        template: template ?? null,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[tc/drafts POST] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
