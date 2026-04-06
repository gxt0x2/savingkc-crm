'use client'

import { useAriPage } from '@/hooks/use-ari-page'
import { DailyProgressBar } from '@/components/ari/daily-progress-bar'
import { CoachingBanner } from '@/components/ari/coaching-banner'
import { CallBlock } from '@/components/ari/call-block'
import { FollowUpBlock } from '@/components/ari/follow-up-block'
import { InboxBlock } from '@/components/ari/inbox-block'
import { PipelineActionsBlock } from '@/components/ari/pipeline-actions-block'
import { EndOfDayBlock } from '@/components/ari/end-of-day-block'

export default function AriPage() {
  const data = useAriPage()

  // Calculate inbox cleared (total inbox items that have been replied to — for now, 0 pending = all cleared)
  const inboxCleared = Math.max(0, (data.inboxCount || 0) - data.inboxItems.length)

  return (
    <>
      {/* Sticky Progress Bar */}
      <DailyProgressBar
        callsDone={data.callCounts.dials}
        callsTarget={data.callTargets.dials}
        tasksDone={data.followUpCompleted}
        tasksTotal={data.followUpTotal}
        inboxCleared={data.inboxItems.length === 0 ? 1 : 0}
        inboxTotal={1}
        pipelineHandled={data.pipelineHandled}
        pipelineTotal={data.pipelineTotal}
      />

      {/* Main Content */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-6 pb-32">
        {/* Section 1: Coaching Banner */}
        <CoachingBanner coaching={data.coaching} loading={data.loading} />

        {/* Section 2: Call Block */}
        <CallBlock
          queue={data.callQueue}
          counts={data.callCounts}
          targets={data.callTargets}
          loading={data.loading}
        />

        {/* Section 3: Follow-Ups */}
        <FollowUpBlock
          followUps={data.followUps}
          completed={data.followUpCompleted}
          total={data.followUpTotal}
          loading={data.loading}
          onRefresh={data.refreshFollowUps}
        />

        {/* Section 4: Inbox */}
        <InboxBlock
          items={data.inboxItems}
          count={data.inboxCount}
          loading={data.loading}
          onRefresh={data.refreshInbox}
        />

        {/* Section 5: Pipeline Actions */}
        <PipelineActionsBlock
          actions={data.pipelineActions}
          handled={data.pipelineHandled}
          total={data.pipelineTotal}
          loading={data.loading}
        />

        {/* Section 6: End of Day */}
        <EndOfDayBlock
          eod={data.eod}
          activityCounts={data.activityCounts}
          followUpCompleted={data.followUpCompleted}
          followUpTotal={data.followUpTotal}
          inboxCount={data.inboxItems.length}
          pipelineHandled={data.pipelineHandled}
          pipelineTotal={data.pipelineTotal}
          loading={data.loading}
        />
      </div>
    </>
  )
}
