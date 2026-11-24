const EMAIL_TYPES = new Set(['email', 'email_sent', 'email_received'])

type EmailBodyRow = {
  gmail_message_id: string | null
  body_text: string | null
  body_snippet: string | null
}

type EmailBodyQuery = {
  eq: (column: string, value: string) => {
    in: (column: string, values: readonly string[]) => {
      limit: (count: number) => PromiseLike<{ data: EmailBodyRow[] | null; error: { message?: string } | null }>
    }
  }
}

export type LeadEmailBodyReader = {
  from: (table: 'lead_emails') => {
    select: (columns: string) => EmailBodyQuery
  }
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Copy stored Gmail body fields onto email activities. Description stays the timeline line. */
export async function attachLeadEmailBodies<T extends { activity_type: string; metadata: unknown }>(
  db: LeadEmailBodyReader,
  leadId: string,
  activities: T[],
): Promise<T[]> {
  const messageIds = [...new Set(activities.flatMap((activity) => {
    if (!EMAIL_TYPES.has(activity.activity_type)) return []
    const messageId = metadataRecord(activity.metadata)?.gmail_message_id
    return typeof messageId === 'string' && messageId ? [messageId] : []
  }))]
  if (!messageIds.length) return activities
  const { data, error } = await db.from('lead_emails')
    .select('gmail_message_id, body_text, body_snippet')
    .eq('lead_id', leadId)
    .in('gmail_message_id', messageIds)
    .limit(messageIds.length)
  if (error) {
    console.error('[mobile-conversations] lead email body lookup failed', error)
    return activities
  }
  const byMessage = new Map<string, { body_text: string | null; body_snippet: string | null }>()
  for (const row of data ?? []) {
    if (!row.gmail_message_id) continue
    const current = byMessage.get(row.gmail_message_id)
    if (!current || (current.body_text == null && row.body_text != null)) {
      byMessage.set(row.gmail_message_id, { body_text: row.body_text, body_snippet: row.body_snippet })
    }
  }
  return activities.map((activity) => {
    if (!EMAIL_TYPES.has(activity.activity_type)) return activity
    const messageId = metadataRecord(activity.metadata)?.gmail_message_id
    if (typeof messageId !== 'string') return activity
    const body = byMessage.get(messageId)
    if (!body) return activity
    return {
      ...activity,
      metadata: { ...(metadataRecord(activity.metadata) ?? {}), body_text: body.body_text, body_snippet: body.body_snippet },
    }
  })
}
