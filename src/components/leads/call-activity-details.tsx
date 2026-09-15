'use client'

import { CallReviewSubmitButton } from '@/components/call-review/call-review-submit-button'
import { Icon } from '@/components/ui/icon'
import type { LeadConversationActivity } from '@/lib/lead-conversation'
import { playableRecordingUrl } from '@/lib/marketing/call-recordings'

export function CallActivityDetails({ activity }: { activity: LeadConversationActivity }) {
  const recordingUrl = playableRecordingUrl(activity.metadata)
  if (!recordingUrl && !activity.callSummary && !activity.callTranscript) return null

  return (
    <details className="mt-2 rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface)]">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold text-[var(--crm-brand)] [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <Icon name={recordingUrl ? 'play_circle' : 'notes'} className="text-[17px]" />
          {recordingUrl ? 'Recording & details' : 'Call details'}
        </span>
      </summary>
      <div className="border-t border-[var(--crm-border)] px-3 pb-3">
        {recordingUrl ? (
          <>
            <audio className="mt-3 w-full accent-[var(--crm-brand)]" controls preload="metadata" src={recordingUrl}>
              Your browser does not support call recording playback.
            </audio>
            <CallReviewSubmitButton activityId={activity.recordingActivityId || activity.id} recordingUrl={recordingUrl} />
          </>
        ) : null}
        {activity.callSummary ? (
          <div className="mt-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">AI summary</p>
            <p className="mt-1 text-sm leading-5 text-[var(--crm-text)]">{activity.callSummary}</p>
          </div>
        ) : null}
        {activity.callTranscript ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-bold text-[var(--crm-text-muted)]">Transcript</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[var(--crm-text-muted)]">{activity.callTranscript}</p>
          </details>
        ) : null}
      </div>
    </details>
  )
}
