import type { PilotThread } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'

export function EmailCallbackReview({ request, stopped, canWork, owns, blocked, onApprove, onTakeOver }: {
  request: NonNullable<PilotThread['callback_request']>
  stopped: boolean
  canWork: boolean
  owns: boolean
  blocked: boolean
  onApprove: () => void
  onTakeOver: () => void
}) {
  return <>
    {stopped && <p>Marketing remains stopped. This review does not authorize email or an automatic call.</p>}
    {request.reviewed ? <p>Test reviewed. No seller Lead, task, appointment or call was created.</p> : <>
      <p>{request.testOnly
        ? 'Explicit test message. Record the review without creating a seller Lead or callable task.'
        : 'A new callback request needs human review before a Lead or follow-up task can be created.'}</p>
      <p>{request.phone}{request.time ? ` · ${request.time}` : ''}</p>
      {canWork && (owns
        ? <button className={styles.primary} disabled={blocked} onClick={onApprove}>{request.testOnly ? 'Record test review' : 'Approve callback handoff'}</button>
        : <button disabled={blocked} onClick={onTakeOver}>Take over callback review</button>)}
    </>}
  </>
}
