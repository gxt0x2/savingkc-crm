import type { PilotThread } from '@/lib/email/workflow/types'
import { formatPhone } from '@/lib/format'
import styles from './email-workspace.module.css'

export function EmailCallbackReview({ request, stopped, canWork, owns, blocked, busy, onBackToInbox, onApprove, onTakeOver }: {
  request: NonNullable<PilotThread['callback_request']>
  stopped: boolean
  canWork: boolean
  owns: boolean
  busy: boolean
  onBackToInbox: () => void
  blocked: boolean
  onApprove: () => void
  onTakeOver: () => void
}) {
  return <>
    {request.reviewed ? <div role="status">
      <p><strong>✓ Moved to Done.</strong> Nothing else is needed for this conversation.</p>
      <p>This was a test number, so no real Lead or callback task was created.</p>
      <button className={styles.primary} onClick={onBackToInbox}>Back to inbox</button>
    </div> : <>
      <p>{request.testOnly
        ? 'This message contains a test number. Finish the test to move this conversation to Done.'
        : request.explicitCall === false ? 'The sender shared a phone number. Review the conversation before approving a callback. No call or appointment has been scheduled.'
        : 'The sender asked for a call. Approve the handoff so CRM can check the Lead details and route the follow-up to your callback team.'}</p>
      <p><strong>{formatPhone(request.phone)}</strong>{request.time ? ` · ${request.time}` : ''}</p>
      {request.testOnly && <p>No real Lead or callback task will be created.</p>}
      {canWork ? (owns
        ? <button className={styles.primary} disabled={blocked} onClick={onApprove}>{busy ? 'Saving…' : request.testOnly ? 'Finish test' : 'Approve & route callback'}</button>
        : <button disabled={blocked} onClick={onTakeOver}>{busy ? 'Saving…' : 'Take ownership to review'}</button>)
        : <p>Your assigned reviewer must complete this step.</p>}
    </>}
    {stopped && <p><small>Marketing remains stopped.</small></p>}
  </>
}
