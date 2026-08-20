import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { supabase } from '@/lib/supabase-lazy'

type ThreadStateAction = 'mark_read' | 'mark_unread' | 'reminder_created' | 'reminder_completed' | 'tag_added' | 'tag_removed'

const ACTION_LABELS: Record<ThreadStateAction, string> = {
  mark_read: 'marked read',
  mark_unread: 'marked unread',
  reminder_created: 'reminder set',
  reminder_completed: 'reminder completed',
  tag_added: 'tag added',
  tag_removed: 'tag removed',
}

function cleanAction(value: unknown): ThreadStateAction | null {
  if (
    value === 'mark_read' ||
    value === 'mark_unread' ||
    value === 'reminder_created' ||
    value === 'reminder_completed' ||
    value === 'tag_added' ||
    value === 'tag_removed'
  ) {
    return value
  }
  return null
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanDueAt(value: unknown): string | null {
  const raw = cleanText(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function cleanTag(value: unknown): string | null {
  const raw = cleanText(value)
  if (!raw) return null
  const normalized = raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || null
}

function auditSource(value: unknown): 'conversation_hub' | 'dialer_prospecting_hub' {
  return value === 'dialer_prospecting_hub' ? 'dialer_prospecting_hub' : 'conversation_hub'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ConversationThreadIdentity {
  threadKey: string
  leadId: string | null
  phone: string | null
}

function normalizeLeadId(value: string | null): string | null {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

function unmatchedPhone(value: string | null): string | null {
  return value?.toLowerCase().startsWith('unmatched:')
    ? normalizePhoneToE164(value.slice(value.indexOf(':') + 1))
    : null
}

function resolveThreadIdentity(body: Record<string, unknown>): ConversationThreadIdentity | null {
  const suppliedThreadKey = cleanText(body.threadKey)
  const suppliedLeadId = cleanText(body.leadId)
  const suppliedPhone = cleanText(body.phone)
  const normalizedSuppliedPhone = suppliedPhone ? normalizePhoneToE164(suppliedPhone) : null

  if (suppliedPhone && !normalizedSuppliedPhone) return null

  if (suppliedThreadKey) {
    const separator = suppliedThreadKey.indexOf(':')
    const kind = separator > 0 ? suppliedThreadKey.slice(0, separator).trim().toLowerCase() : ''
    const value = separator > 0 ? suppliedThreadKey.slice(separator + 1).trim() : ''

    if (kind === 'lead') {
      const leadId = normalizeLeadId(value)
      if (!leadId) return null
      if (suppliedLeadId && normalizeLeadId(suppliedLeadId) !== leadId) return null
      return { threadKey: `lead:${leadId}`, leadId, phone: null }
    }

    if (kind === 'phone') {
      const phone = normalizePhoneToE164(value)
      if (!phone || (normalizedSuppliedPhone && normalizedSuppliedPhone !== phone)) return null
      if (suppliedLeadId) {
        const legacyPhone = unmatchedPhone(suppliedLeadId)
        if (legacyPhone !== phone) return null
      }
      return { threadKey: `phone:${phone}`, leadId: null, phone }
    }

    return null
  }

  const leadId = normalizeLeadId(suppliedLeadId)
  if (leadId) {
    return { threadKey: `lead:${leadId}`, leadId, phone: null }
  }

  const legacyPhone = unmatchedPhone(suppliedLeadId)
  const phone = normalizedSuppliedPhone ?? legacyPhone
  if (!phone || (suppliedLeadId && !legacyPhone)) return null
  if (legacyPhone && normalizedSuppliedPhone && legacyPhone !== normalizedSuppliedPhone) return null
  return { threadKey: `phone:${phone}`, leadId: null, phone }
}

function tagLabel(tag: string | null): string | null {
  if (!tag) return null
  return tag
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function actionDescription(action: ThreadStateAction, phone: string | null, dueAt: string | null, tag: string | null): string {
  if (action === 'reminder_created') {
    const due = dueAt ? new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'soon'
    return `Conversation reminder set for ${due}${phone ? `: ${phone}` : ''}`
  }
  if (action === 'tag_added' || action === 'tag_removed') {
    return `Conversation ${action === 'tag_added' ? 'tagged' : 'untagged'} ${tagLabel(tag) || 'Tag'}${phone ? `: ${phone}` : ''}`
  }
  return `Conversation ${ACTION_LABELS[action]}${phone ? `: ${phone}` : ''}`
}

export async function POST(req: Request) {
  try {
    const authenticatedActor = await resolveAuthenticatedActor()
    if (!authenticatedActor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json() as Record<string, unknown>
    const action = cleanAction(body?.action)
    const thread = resolveThreadIdentity(body)
    const source = auditSource(body.source)
    const prospectPhoneId = cleanText(body?.prospectPhoneId)
    const reminderNote = cleanText(body?.note)
    const dueAt = cleanDueAt(body?.dueAt)
    const tag = cleanTag(body?.tag)

    if (!action) {
      return NextResponse.json({ error: 'Valid action is required' }, { status: 400 })
    }
    if (!thread) {
      return NextResponse.json({ error: 'A valid, matching conversation threadKey is required' }, { status: 400 })
    }
    if (action === 'reminder_created' && !dueAt) {
      return NextResponse.json({ error: 'A valid dueAt is required for reminders' }, { status: 400 })
    }
    if ((action === 'tag_added' || action === 'tag_removed') && !tag) {
      return NextResponse.json({ error: 'A valid tag is required' }, { status: 400 })
    }

    const { error } = await supabase.from('lead_activities').insert({
      lead_id: thread.leadId,
      activity_type: 'status_change',
      description: actionDescription(action, thread.phone, dueAt, tag),
      agent: authenticatedActor.name,
      metadata: {
        source,
        thread_key: thread.threadKey,
        hub_action: action,
        ...(thread.phone ? { phone: thread.phone } : {}),
        ...(prospectPhoneId ? { prospect_phone_id: prospectPhoneId } : {}),
        ...(dueAt ? { reminder_due_at: dueAt } : {}),
        ...(reminderNote ? { reminder_note: reminderNote } : {}),
        ...(tag ? { hub_tag: tag, hub_tag_label: tagLabel(tag) } : {}),
      },
    })

    if (error) {
      console.error('[conversations/thread-state] activity insert failed:', error.message)
      return NextResponse.json({ error: 'Conversation state could not be saved' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      action,
      dueAt,
      tag,
      message: ACTION_LABELS[action],
    })
  } catch (err) {
    console.error('[conversations/thread-state] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
