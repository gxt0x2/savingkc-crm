import type { PilotThread } from './types'

export function formatEmailTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value)) + ' CT'
    : 'Not set'
}

/** Practice-only text rules. Never label this as a model response. Quoted
 * history and signatures are excluded; evidence always remains inspectable. */
export function practiceReply(body: string) {
  const text = body
    .split(/\n(?:On .+wrote:|From:|--\s*$|Sent from my)/im)[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .trim()
  const number = text.match(
    /(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?\d{3}[ .-]?\d{4}/,
  )?.[0]
  const explicitCall = /\b(call me|give me a call|reach me|my number)\b/i.test(
    text,
  )
  const numberOnly = Boolean(
    number && text.replace(number, '').replace(/[\s.!-]/g, '') === '',
  )
  const thirdParty =
    /\b(his|her|their|brother|sister|attorney|agent|wrong person|wrong number|not interested|not selling|do not want to sell|don't want to sell|do not call|don't call)\b/i.test(
      text,
    )
  const optedOut = /\b(unsubscribe|stop emailing|remove me)\b/i.test(text)
  const phone =
    number && !thirdParty && !optedOut && (explicitCall || numberOnly)
      ? number
      : undefined
  const time = text.match(
    /\b(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday)(?:\s+(?:morning|afternoon|evening)|\s+(?:after|at)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i,
  )?.[0]
  const interest =
    !thirdParty &&
    !optedOut &&
    (/\b(?:consider selling|interested in selling|want to sell|might sell)\b/i.test(
      text,
    ) ||
      Boolean(phone))
  return {
    phone,
    time,
    interest,
    body: optedOut
      ? ''
      : phone
        ? time
          ? 'What time works best for a quick call?'
          : 'When would be a good time for a quick call?'
        : interest
          ? 'What would you want to figure out before deciding whether to sell?'
          : '',
  }
}

export function hasCrmIssue(thread: PilotThread) {
  return (
    thread.callback_owner_changed ||
    thread.crm_history_repair_required ||
    thread.crm_callback_repair_required ||
    ['pending', 'review_required', 'dependency_unavailable'].includes(
      thread.crm_sync_state ?? '',
    ) ||
    thread.handoff_state === 'held' ||
    thread.callback_task_state === 'blocked'
  )
}

export function nextWork(thread: PilotThread, asOf: string) {
  if (thread.inbound_pending) return 'Loading received reply'
  if (hasCrmIssue(thread)) return 'Resolve issue'
  if (thread.sending_issue) return 'Review sending'
  if (thread.callback_request && !thread.callback_request.reviewed) return thread.callback_request.testOnly ? 'Finish callback test' : 'Review callback request'
  if (thread.callback_request?.reviewed) return 'Test complete'
  if (thread.state === 'stopped' && thread.callback_task_state === 'pending') return 'Callback follow-up · marketing stopped'
  if (thread.state === 'stopped') return 'Marketing stopped'
  if (thread.state === 'done') return 'Done'
  if (thread.state === 'needs_review') return 'Reply received'
  if (thread.scheduled_for && thread.callback_task_state === 'pending')
    return new Date(thread.scheduled_for) > new Date(asOf)
      ? 'Follow-up scheduled'
      : 'Follow-up due'
  if (thread.callback_task_state === 'pending') return 'Arrange call'
  if (thread.reply_queued) return 'Reply queued'
  if (thread.state === 'human') return 'Prepare reply'
  return thread.has_outbound ? 'Waiting on seller' : 'First email scheduled'
}
