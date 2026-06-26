import { NextResponse } from 'next/server'
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
    const body = await req.json()
    const action = cleanAction(body?.action)
    const leadId = cleanText(body?.leadId)
    const phone = cleanText(body?.phone)
    const agent = cleanText(body?.agent) || 'System'
    const source = cleanText(body?.source) || 'dialer_prospecting_hub'
    const prospectPhoneId = cleanText(body?.prospectPhoneId)
    const reminderNote = cleanText(body?.note)
    const dueAt = cleanDueAt(body?.dueAt)
    const tag = cleanTag(body?.tag)

    if (!action) {
      return NextResponse.json({ error: 'Valid action is required' }, { status: 400 })
    }
    if (!leadId && !phone) {
      return NextResponse.json({ error: 'leadId or phone is required' }, { status: 400 })
    }
    if (action === 'reminder_created' && !dueAt) {
      return NextResponse.json({ error: 'A valid dueAt is required for reminders' }, { status: 400 })
    }
    if ((action === 'tag_added' || action === 'tag_removed') && !tag) {
      return NextResponse.json({ error: 'A valid tag is required' }, { status: 400 })
    }

    const { error } = await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'status_change',
      description: actionDescription(action, phone, dueAt, tag),
      agent,
      metadata: {
        source,
        hub_action: action,
        ...(phone ? { phone } : {}),
        ...(prospectPhoneId ? { prospect_phone_id: prospectPhoneId } : {}),
        ...(dueAt ? { reminder_due_at: dueAt } : {}),
        ...(reminderNote ? { reminder_note: reminderNote } : {}),
        ...(tag ? { hub_tag: tag, hub_tag_label: tagLabel(tag) } : {}),
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
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
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
