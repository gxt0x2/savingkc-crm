/**
 * A bare YES is a hot seller signal only when it answers an automated
 * "Reply YES" prompt. Human 1:1 texts, and anything we cannot classify,
 * stay on the normal reply alert.
 *
 * Automated prompts are the missed-call text-back, IVR text, and company-line
 * auto-text rows already stored with these trigger or template values:
 * missed_call_auto, cold_callback_auto_text, missed_call_followup,
 * missed_call_unknown.
 */

const AUTOMATED_REPLY_YES_TRIGGERS = new Set([
  'missed_call_auto',
  'cold_callback_auto_text',
  'missed_call_followup',
])

const AUTOMATED_REPLY_YES_TEMPLATES = new Set([
  'missed_call_unknown',
])

const HUMAN_ONE_TO_ONE_SOURCES = new Set([
  'mobile_app',
  'conversation_hub',
  'heir_dialer',
])

const HUMAN_ONE_TO_ONE_TEMPLATES = new Set([
  'sms.conversation.1to1.v1',
])

const OUTBOUND_DIRECTIONS = ['outbound', 'sent', 'out']

type ActivityRow = {
  id?: string | null
  metadata?: unknown
  lead_id?: string | null
}

type ActivityQuery = {
  eq: (column: string, value: string) => ActivityQuery
  in: (column: string, value: readonly string[]) => ActivityQuery
  order: (column: string, options: { ascending: boolean }) => ActivityQuery
  limit: (count: number) => ActivityQuery
  maybeSingle: () => PromiseLike<{ data: ActivityRow | null; error: { message?: string } | null }>
}

export type ReplyYesPromptDb = {
  from: (table: 'lead_activities') => {
    select: (columns: string) => ActivityQuery
  }
}

function token(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** True only for a stored automated Reply YES prompt. Human 1:1 and unknown rows are false. */
export function isAutomatedReplyYesPrompt(metadata: unknown): boolean {
  const record = metadataRecord(metadata)
  if (!record) return false
  const source = token(record.source)
  const template = token(record.template_id) ?? token(record.template_name)
  if ((source && HUMAN_ONE_TO_ONE_SOURCES.has(source)) || (template && HUMAN_ONE_TO_ONE_TEMPLATES.has(template))) {
    return false
  }
  const trigger = token(record.trigger)
  if (trigger && AUTOMATED_REPLY_YES_TRIGGERS.has(trigger)) return true
  return Boolean(template && AUTOMATED_REPLY_YES_TEMPLATES.has(template))
}

async function readActivity(
  db: ReplyYesPromptDb,
  build: (query: ActivityQuery) => ActivityQuery,
): Promise<ActivityRow | null> {
  const { data, error } = await build(db.from('lead_activities').select('id, metadata, lead_id')).maybeSingle()
  if (error) throw new Error(error.message || 'outbound SMS lookup failed')
  return data
}

/**
 * Whether this inbound YES answers the matched outbound, or the lead's most
 * recent outbound when no match was recorded. Lookup trouble returns false.
 */
export async function inboundAnswersAutomatedYesPrompt(
  db: ReplyYesPromptDb,
  input: { matchedOutboundActivityId: string | null; leadId: string | null; customerPhone: string },
): Promise<boolean> {
  try {
    const matchedId = input.matchedOutboundActivityId?.trim() || null
    const row = matchedId
      ? await readActivity(db, (query) => query.eq('id', matchedId))
      : input.leadId
        ? await readActivity(db, (query) => query
          .eq('lead_id', input.leadId as string)
          .eq('activity_type', 'sms')
          .in('metadata->>direction', OUTBOUND_DIRECTIONS)
          .order('created_at', { ascending: false })
          .limit(1))
        : await readActivity(db, (query) => query
          .eq('activity_type', 'sms')
          .eq('metadata->>to', input.customerPhone)
          .in('metadata->>direction', OUTBOUND_DIRECTIONS)
          .order('created_at', { ascending: false })
          .limit(1))
    return isAutomatedReplyYesPrompt(row?.metadata)
  } catch (error) {
    console.error('[twilio-sms-webhook] Reply YES prompt lookup failed closed', error)
    return false
  }
}
