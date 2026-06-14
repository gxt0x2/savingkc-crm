'use client'

import { useRef } from 'react'
import { trackEvent } from './track-events'

interface DealVideoProps {
  slug: string
  url: string
  index: number
}

function percent(video: HTMLVideoElement): number {
  if (!video.duration || !Number.isFinite(video.duration)) return 0
  return Math.max(0, Math.min(100, Math.round((video.currentTime / video.duration) * 100)))
}

export function DealVideo({ slug, url, index }: DealVideoProps) {
  const startedRef = useRef(false)
  const milestonesRef = useRef<Set<number>>(new Set())
  const title = `Deal video ${index + 1}`
  const basePayload = {
    section: 'videos',
    placement: 'deal_page_videos',
    video_id: `deal_video_${index + 1}`,
    video_title: title,
    title,
    position: index + 1,
  }

  function trackStarted(video: HTMLVideoElement) {
    if (startedRef.current) return
    startedRef.current = true
    const watchPercent = percent(video)
    trackEvent(slug, 'video_started', {
      ...basePayload,
      percent: watchPercent,
      watch_percent: watchPercent,
    })
  }

  function trackMilestones(video: HTMLVideoElement) {
    const watchPercent = percent(video)
    ;([25, 50, 75] as const).forEach((threshold) => {
      if (watchPercent < threshold || milestonesRef.current.has(threshold)) return
      milestonesRef.current.add(threshold)
      trackEvent(slug, `video_progress_${threshold}`, {
        ...basePayload,
        percent: threshold,
        watch_percent: watchPercent,
      })
    })
  }

  return (
    <video
      controls
      className="w-full rounded-xl"
      preload="metadata"
      onPlay={(event) => trackStarted(event.currentTarget)}
      onTimeUpdate={(event) => trackMilestones(event.currentTarget)}
      onPause={(event) => {
        if (event.currentTarget.ended) return
        const watchPercent = percent(event.currentTarget)
        trackEvent(slug, 'video_paused', {
          ...basePayload,
          percent: watchPercent,
          watch_percent: watchPercent,
        })
      }}
      onEnded={() => {
        milestonesRef.current.add(25)
        milestonesRef.current.add(50)
        milestonesRef.current.add(75)
        trackEvent(slug, 'video_completed', {
          ...basePayload,
          percent: 100,
          watch_percent: 100,
        })
      }}
    >
      <source src={url} />
    </video>
  )
}
