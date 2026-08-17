'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CALL_SCORE_RUBRIC, getCallReviewFramework, type CallReviewFrameworkId } from '@/lib/call-review-frameworks'
import { scoreCallReview } from '@/lib/call-review-scoring'
import { readPreviewCallReviewQueue, readPreviewCallReviewResult, savePreviewCallReviewResult } from '@/lib/call-review-preview-queue'
type Workflow = {
  status: 'available' | 'submitted' | 'completed'
  framework: CallReviewFrameworkId | null
  score: number | null
  criticalScore?: number | null
  needsCoaching?: boolean
  coachingReasons?: string[]
  scoringVersion?: string | null
  submittedBy: string | null
  assignedReviewer: string | null
  completedBy?: string | null
  reviewNote?: string | null
  answers?: Record<string, number>
  tags: string[]
  voiceoverPath?: string | null
  voiceoverMimeType?: string | null
  aiStatus?: 'idle' | 'processing' | 'ready' | 'failed'
  aiProcessedAt?: string | null
  aiModel?: string | null
  aiError?: string | null
  aiScore?: number | null
  aiCriticalScore?: number | null
  aiAnswers?: Record<
    string,
    {
      score: number
      confidence: 'low' | 'medium' | 'high'
      evidence: string
      timestamp: string | null
      reasoning: string
    }
  >
  aiCorrections?: string[]
}

type ReviewCall = {
  id: string
  leadName: string
  recordingUrl: string
  durationSeconds: number
  analysisSummary: string | null
  reviewWorkflow: Workflow
  previewLocal?: boolean
}

type QueueView = 'assigned' | 'completed'
type ReviewMode = 'idle' | 'call' | 'comment'
const TEST_REVIEW_STORAGE_KEY = 'savingkc:test-scorecard-review'

function testCall(viewerEmail: string, savedWorkflow?: Workflow | null): ReviewCall {
  const framework = getCallReviewFramework('junior_acquisitions')
  const recoveredAnswers = Object.fromEntries(framework?.sections.flatMap((section) => section.items.map((item) => [item.id, 2])) || [])
  const recoveredWorkflow: Workflow = {
    status: 'completed',
    framework: 'junior_acquisitions',
    score: 2,
    submittedBy: 'casey@savingkc.com',
    assignedReviewer: viewerEmail,
    completedBy: viewerEmail,
    reviewNote: 'Recovered completed test review.',
    answers: recoveredAnswers,
    tags: ['Needs Coaching', 'Motivation'],
    voiceoverPath: '/audio/ernest-voicemail.mp3',
    voiceoverMimeType: 'audio/mpeg',
  }
  return {
    id: 'test-review-preview',
    leadName: 'TEST SCORECARD - Jordan Seller',
    recordingUrl: '/audio/ivr-voicemail.mp3',
    durationSeconds: 5,
    analysisSummary: 'Confirm motivation, timeline, decision makers, and a committed next step.',
    reviewWorkflow: savedWorkflow
      ? {
          ...recoveredWorkflow,
          ...savedWorkflow,
          voiceoverPath: savedWorkflow.voiceoverPath || recoveredWorkflow.voiceoverPath,
          voiceoverMimeType: savedWorkflow.voiceoverMimeType || recoveredWorkflow.voiceoverMimeType,
        }
      : recoveredWorkflow,
  }
}

function savedTestWorkflow() {
  try {
    const saved = window.localStorage.getItem(TEST_REVIEW_STORAGE_KEY)
    return saved ? (JSON.parse(saved) as Workflow) : null
  } catch {
    return null
  }
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function reviewRecordingUrl(call: ReviewCall) {
  const path = call.reviewWorkflow.voiceoverPath
  if (!path) return null
  return path.startsWith('/') || path.startsWith('blob:') || path.startsWith('data:') ? path : `/api/marketing/call-review-voiceover?path=${encodeURIComponent(path)}`
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Review recording could not be preserved.'))
    reader.readAsDataURL(blob)
  })
}

function CompletedScorecardOverlay({ call, onClose }: { call: ReviewCall; onClose: () => void }) {
  const workflow = call.reviewWorkflow
  const framework = getCallReviewFramework(workflow.framework || 'junior_acquisitions')
  const coachingRecording = reviewRecordingUrl(call)
  if (!framework) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <section role="dialog" aria-modal="true" aria-labelledby="completed-scorecard-title" className="h-full w-full max-w-[820px] overflow-y-auto bg-[var(--crm-surface)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="crm-eyebrow">Completed scorecard</p>
            <h2 id="completed-scorecard-title" className="text-2xl font-black">
              {call.leadName}
            </h2>
            <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Reviewed by {workflow.completedBy || 'Reviewer'}</p>
          </div>
          <button type="button" aria-label="Close completed scorecard" onClick={onClose} className="crm-icon-button h-9 w-9 rounded-lg">
            <Icon name="close" />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--crm-border)] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Final score</p>
            <strong className="mt-1 block text-2xl text-[var(--crm-brand)]">{(workflow.score ?? 0).toFixed(2)} / 3</strong>
          </div>
          <div className="rounded-xl border border-[var(--crm-border)] p-4 sm:col-span-2">
            <p className="text-xs font-black">
              Original call <span className="font-bold text-[var(--crm-text-muted)]">· {formatDuration(call.durationSeconds)}</span>
            </p>
            <audio controls preload="metadata" src={call.recordingUrl} className="mt-2 w-full" />
          </div>
        </div>
        {coachingRecording ? (
          <div className="mt-3 rounded-xl border border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] p-4">
            <p className="flex items-center gap-2 text-xs font-black text-[var(--crm-brand)]">
              <Icon name="mic" />
              {call.id === 'test-review-preview' ? 'Sample coaching review · 0:14' : 'Coaching review'}
            </p>
            <audio controls preload="metadata" src={coachingRecording} className="mt-2 w-full" />
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-[var(--crm-warning)] bg-[var(--crm-warning-soft)] p-4">
            <p className="flex items-center gap-2 text-xs font-black text-[var(--crm-warning)]">
              <Icon name="mic_off" />
              Coaching recording unavailable
            </p>
            <p className="mt-1 text-xs text-[var(--crm-text-muted)]">This recovered test scorecard did not retain the earlier voiceover recording.</p>
          </div>
        )}
        {workflow.reviewNote ? (
          <div className="mt-3 rounded-xl border border-[var(--crm-border)] p-4">
            <p className="text-xs font-black">Coaching note</p>
            <p className="mt-2 text-sm leading-6">{workflow.reviewNote}</p>
          </div>
        ) : null}
        {workflow.aiStatus === 'ready' ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-[var(--crm-border)] p-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">AI pre-score</p>
              <strong className="mt-1 block text-lg">{(workflow.aiScore ?? 0).toFixed(2)} / 3</strong>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Human corrections</p>
              <strong className="mt-1 block text-lg">{workflow.aiCorrections?.length || 0} items</strong>
            </div>
          </div>
        ) : null}
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--crm-border)]">
          <div className="border-b border-[var(--crm-border)] p-4">
            <h3 className="font-black">{framework.label}</h3>
            <p className="text-xs text-[var(--crm-text-muted)]">Final item-by-item assessment</p>
          </div>
          <div className="divide-y divide-[var(--crm-border)]">
            {framework.sections.map((section) => (
              <div key={section.label} className="p-4">
                <h4 className="mb-3 font-black">{section.label}</h4>
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const value = workflow.answers?.[item.id]
                    const rubric = CALL_SCORE_RUBRIC.find((level) => level.value === value)
                    return (
                      <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_42px_110px] items-center gap-3 rounded-lg border border-[var(--crm-border)] px-3 py-2">
                        <span className="text-xs font-semibold">{item.label}</span>
                        <strong className="text-center">{typeof value === 'number' ? value : '—'}</strong>
                        <span className="text-[10px] font-bold text-[var(--crm-text-muted)]">{rubric?.label || 'Not scored'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export function MyDayCallReview({ onReviewActiveChange }: { onReviewActiveChange?: (active: boolean) => void }) {
  const [calls, setCalls] = useState<ReviewCall[]>([])
  const [viewerEmail, setViewerEmail] = useState('')
  const [view, setView] = useState<QueueView>('assigned')
  const [reviewing, setReviewing] = useState<ReviewCall | null>(null)
  const [viewingCompleted, setViewingCompleted] = useState<ReviewCall | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordingVoiceover, setRecordingVoiceover] = useState(false)
  const [voiceoverBlob, setVoiceoverBlob] = useState<Blob | null>(null)
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null)
  const [reviewMode, setReviewMode] = useState<ReviewMode>('idle')
  const [callPosition, setCallPosition] = useState(0)
  const [callDuration, setCallDuration] = useState(0)
  const [reviewElapsed, setReviewElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const originalAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const callSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const mixNodesRef = useRef<AudioNode[]>([])
  const callGainRef = useRef<GainNode | null>(null)
  const microphoneGainRef = useRef<GainNode | null>(null)
  const reviewStartedAtRef = useRef<number | null>(null)
  const reviewTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void fetch('/api/marketing/call-recordings?days=30&minDuration=30', {
      cache: 'no-store',
    })
      .then(async (response) => (response.ok ? response.json() : Promise.reject(new Error('Scorecard reviews could not load.'))))
      .then((payload: { recordings: ReviewCall[]; viewerEmail: string }) => {
        const preview = window.location.hostname.endsWith('.vercel.app') || window.location.hostname === 'localhost'
        const previewCalls: ReviewCall[] = preview
          ? readPreviewCallReviewQueue(window.localStorage).map((submission) => {
              const id = submission.activityId || submission.recordingSid || `preview-${submission.submittedAt}`
              const savedResult = readPreviewCallReviewResult<Workflow>(window.localStorage, id)
              return {
                id,
                leadName: `Preview submitted call${submission.recordingSid ? ` · ${submission.recordingSid.slice(-8)}` : ''}`,
                recordingUrl: submission.recordingUrl,
                durationSeconds: submission.durationSeconds,
                analysisSummary: 'Preview-safe review. Production data was not changed.',
                previewLocal: true,
                reviewWorkflow: savedResult || {
                  status: 'submitted',
                  framework: 'junior_acquisitions',
                  score: null,
                  submittedBy: 'preview-user',
                  assignedReviewer: payload.viewerEmail,
                  tags: ['Preview'],
                  aiStatus: 'failed',
                  aiError: 'AI pre-scoring runs after production submission. This preview copy can be scored manually.',
                },
              }
            })
          : []
        const previewIds = new Set(previewCalls.map((call) => call.id))
        const submitted = [
          ...previewCalls,
          ...payload.recordings.filter((call) => call.reviewWorkflow.status !== 'available' && !previewIds.has(call.id)),
        ]
        setCalls(preview && !submitted.some((call) => call.id === 'test-review-preview') ? [testCall(payload.viewerEmail, savedTestWorkflow()), ...submitted] : submitted)
        setViewerEmail(payload.viewerEmail || '')
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  useEffect(() => {
    onReviewActiveChange?.(Boolean(reviewing || viewingCompleted))
    return () => onReviewActiveChange?.(false)
  }, [onReviewActiveChange, reviewing, viewingCompleted])

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      mixNodesRef.current.forEach((node) => node.disconnect())
      if (reviewTimerRef.current !== null) window.clearTimeout(reviewTimerRef.current)
      void audioContextRef.current?.close()
    },
    [],
  )

  useEffect(
    () => () => {
      if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl)
    },
    [voiceoverUrl],
  )

  const visibleCalls = useMemo(() => calls.filter((call) => (view === 'assigned' ? call.reviewWorkflow.status === 'submitted' && call.reviewWorkflow.assignedReviewer === viewerEmail : call.reviewWorkflow.status === 'completed' && (call.reviewWorkflow.submittedBy === viewerEmail || call.reviewWorkflow.assignedReviewer === viewerEmail))).slice(0, 6), [calls, view, viewerEmail])

  const assigned = calls.filter((call) => call.reviewWorkflow.status === 'submitted' && call.reviewWorkflow.assignedReviewer === viewerEmail).length
  const completed = calls.filter((call) => call.reviewWorkflow.status === 'completed' && (call.reviewWorkflow.submittedBy === viewerEmail || call.reviewWorkflow.assignedReviewer === viewerEmail)).length
  const framework = reviewing ? getCallReviewFramework(reviewing.reviewWorkflow.framework || 'junior_acquisitions') : null
  const itemCount = framework?.sections.reduce((count, section) => count + section.items.length, 0) || 0
  const liveScoring = framework ? scoreCallReview(framework, ratings) : null
  const liveScore = liveScoring?.score ?? 0

  function openReview(call: ReviewCall) {
    setReviewing(call)
    setRatings(call.reviewWorkflow.aiStatus === 'ready' ? Object.fromEntries(Object.entries(call.reviewWorkflow.aiAnswers || {}).map(([id, assessment]) => [id, assessment.score])) : {})
    setNote('')
    setVoiceoverBlob(null)
    if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl)
    setVoiceoverUrl(null)
  }

  async function retryAiScore(call: ReviewCall) {
    if (call.id === 'test-review-preview' || call.previewLocal) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/marketing/call-recordings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: call.id, action: 'retry_ai' }),
      })
      const payload = (await response.json()) as {
        error?: string
        workflow?: Workflow
      }
      if (!response.ok || !payload.workflow) throw new Error(payload.error || 'AI pre-score could not be restarted.')
      setCalls((current) => current.map((item) => (item.id === call.id ? { ...item, reviewWorkflow: payload.workflow! } : item)))
      setReviewing({ ...call, reviewWorkflow: payload.workflow })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI pre-score could not be restarted.')
    } finally {
      setBusy(false)
    }
  }

  async function startVoiceover() {
    setError(null)
    try {
      const callAudio = originalAudioRef.current
      if (!callAudio) throw new Error('Call audio is unavailable.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextConstructor = window.AudioContext
      const context = audioContextRef.current || new AudioContextConstructor()
      audioContextRef.current = context
      if (context.state === 'suspended') await context.resume()
      if (!callSourceRef.current) {
        callSourceRef.current = context.createMediaElementSource(callAudio)
        callSourceRef.current.connect(context.destination)
      }

      const destination = context.createMediaStreamDestination()
      const callGain = context.createGain()
      const microphoneGain = context.createGain()
      callGain.gain.value = 0.82
      microphoneGain.gain.value = 0
      const microphoneSource = context.createMediaStreamSource(stream)
      callSourceRef.current.connect(callGain).connect(destination)
      microphoneSource.connect(microphoneGain).connect(destination)
      mixNodesRef.current = [callGain, microphoneSource, microphoneGain, destination]
      callGainRef.current = callGain
      microphoneGainRef.current = microphoneGain

      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(destination.stream, preferredType ? { mimeType: preferredType } : undefined)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        })
        setVoiceoverBlob(blob)
        setVoiceoverUrl((current) => {
          if (current) URL.revokeObjectURL(current)
          return URL.createObjectURL(blob)
        })
        stream.getTracks().forEach((track) => track.stop())
        mixNodesRef.current.forEach((node) => node.disconnect())
        mixNodesRef.current = []
        streamRef.current = null
        recorderRef.current = null
        setRecordingVoiceover(false)
        setReviewMode('idle')
        if (reviewTimerRef.current !== null) window.clearTimeout(reviewTimerRef.current)
        reviewTimerRef.current = null
        if (reviewStartedAtRef.current !== null) setReviewElapsed(Math.floor((Date.now() - reviewStartedAtRef.current) / 1000))
      }
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.start(1000)
      setRecordingVoiceover(true)
      setReviewMode('call')
      setReviewElapsed(0)
      reviewStartedAtRef.current = Date.now()
      const updateReviewElapsed = () => {
        if (reviewStartedAtRef.current !== null) setReviewElapsed(Math.floor((Date.now() - reviewStartedAtRef.current) / 1000))
        reviewTimerRef.current = window.setTimeout(updateReviewElapsed, 250)
      }
      reviewTimerRef.current = window.setTimeout(updateReviewElapsed, 250)
      callAudio.currentTime = 0
      await callAudio.play()
    } catch (reason) {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      setRecordingVoiceover(false)
      setReviewMode('idle')
      if (reviewTimerRef.current !== null) window.clearTimeout(reviewTimerRef.current)
      reviewTimerRef.current = null
      setError(reason instanceof Error && reason.message === 'Call audio is unavailable.' ? reason.message : 'Microphone access and playable call audio are required to start Review Mode.')
    }
  }

  function stopVoiceover() {
    originalAudioRef.current?.pause()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  function pauseAndComment() {
    originalAudioRef.current?.pause()
    if (callGainRef.current && audioContextRef.current) callGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime)
    if (microphoneGainRef.current && audioContextRef.current) microphoneGainRef.current.gain.setValueAtTime(1.08, audioContextRef.current.currentTime)
    setReviewMode('comment')
  }

  async function resumeCall() {
    if (microphoneGainRef.current && audioContextRef.current) microphoneGainRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime)
    if (callGainRef.current && audioContextRef.current) callGainRef.current.gain.setValueAtTime(0.82, audioContextRef.current.currentTime)
    setReviewMode('call')
    await originalAudioRef.current?.play()
  }

  function handleCallEnded() {
    if (recordingVoiceover) pauseAndComment()
  }

  function closeReview() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    mixNodesRef.current.forEach((node) => node.disconnect())
    mixNodesRef.current = []
    if (reviewTimerRef.current !== null) window.clearTimeout(reviewTimerRef.current)
    reviewTimerRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    callSourceRef.current = null
    setReviewing(null)
    setReviewMode('idle')
  }

  async function completeReview(call: ReviewCall) {
    const frameworkId = call.reviewWorkflow.framework || 'junior_acquisitions'
    setBusy(true)
    setError(null)
    try {
      let workflow: Workflow
      if (call.id === 'test-review-preview' || call.previewLocal) {
        const preservedVoiceover = voiceoverBlob ? await blobAsDataUrl(voiceoverBlob) : null
        workflow = {
          ...call.reviewWorkflow,
          status: 'completed',
          score: liveScore,
          criticalScore: liveScoring?.criticalScore,
          needsCoaching: liveScoring?.needsCoaching,
          coachingReasons: liveScoring?.coachingReasons,
          scoringVersion: liveScoring?.scoringVersion,
          completedBy: viewerEmail,
          reviewNote: note,
          answers: ratings,
          voiceoverPath: preservedVoiceover,
          voiceoverMimeType: voiceoverBlob?.type || null,
        }
        try {
          if (call.previewLocal) savePreviewCallReviewResult(window.localStorage, call.id, workflow)
          else window.localStorage.setItem(TEST_REVIEW_STORAGE_KEY, JSON.stringify(workflow))
        } catch {
          const fallback = { ...workflow, voiceoverPath: null, voiceoverMimeType: null }
          if (call.previewLocal) savePreviewCallReviewResult(window.localStorage, call.id, fallback)
          else window.localStorage.setItem(TEST_REVIEW_STORAGE_KEY, JSON.stringify(fallback))
        }
      } else {
        let voiceoverPath: string | null = null
        let voiceoverMimeType: string | null = null
        if (voiceoverBlob) {
          const form = new FormData()
          form.set('activityId', call.id)
          form.set('file', new File([voiceoverBlob], `coaching-voiceover.${voiceoverBlob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: voiceoverBlob.type }))
          const uploadResponse = await fetch('/api/marketing/call-review-voiceover', { method: 'POST', body: form })
          const uploadPayload = (await uploadResponse.json()) as {
            error?: string
            path?: string
            mimeType?: string
          }
          if (!uploadResponse.ok || !uploadPayload.path) throw new Error(uploadPayload.error || 'Coaching voiceover could not be attached.')
          voiceoverPath = uploadPayload.path
          voiceoverMimeType = uploadPayload.mimeType || voiceoverBlob.type
        }
        const response = await fetch('/api/marketing/call-recordings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityId: call.id,
            action: 'complete',
            framework: frameworkId,
            answers: ratings,
            note,
            voiceoverPath,
            voiceoverMimeType,
          }),
        })
        const payload = (await response.json()) as {
          error?: string
          workflow?: Workflow
        }
        if (!response.ok || !payload.workflow) throw new Error(payload.error || 'Scorecard could not be saved.')
        workflow = payload.workflow
      }
      setCalls((current) => current.map((item) => (item.id === call.id ? { ...item, reviewWorkflow: workflow } : item)))
      setView('completed')
      setReviewing(null)
      setRatings({})
      setNote('')
      setVoiceoverBlob(null)
      setVoiceoverUrl(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Scorecard could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section aria-labelledby="scorecard-reviews-title" className="crm-panel overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]">
              <Icon name="fact_check" />
            </span>
            <div>
              <h2 id="scorecard-reviews-title" className="text-[20px] font-black">
                Scorecard Reviews
              </h2>
              <p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">Only calls intentionally submitted for review appear here.</p>
            </div>
          </div>
          <div className="flex rounded-lg border border-[var(--crm-border)] p-1 text-xs font-black">
            {(
              [
                ['assigned', `Needs Review (${assigned})`],
                ['completed', `Reviewed (${completed})`],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setView(key)} className={`rounded-md px-3 py-2 ${view === key ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--crm-text-muted)]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {error ? <p className="m-4 rounded-lg bg-[var(--crm-danger-soft)] p-3 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
        {visibleCalls.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm font-bold text-[var(--crm-text-muted)]">
            <Icon name="task_alt" className="text-[var(--crm-success)]" />
            No scorecards in this view
          </div>
        ) : (
          <div className="divide-y divide-[var(--crm-border)]">
            {visibleCalls.map((call) => {
              const attachedReview = reviewRecordingUrl(call)
              return (
                <div key={call.id} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_210px_220px_125px]">
                  <div>
                    <p className="font-black">{call.leadName}</p>
                    <p className="text-[11px] text-[var(--crm-text-muted)]">{call.reviewWorkflow.status === 'completed' ? `${call.reviewWorkflow.score ?? 0} / 3 · ${call.reviewWorkflow.completedBy || 'Reviewed'}` : `Submitted for review · ${formatDuration(call.durationSeconds)}`}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {call.reviewWorkflow.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-info)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{attachedReview ? 'Coaching review' : 'Original call'}</p>
                    <audio aria-label={attachedReview ? 'Attached coaching review' : 'Original call'} controls preload="none" src={attachedReview || call.recordingUrl} className="h-8 w-full" />
                  </div>
                  <span className="truncate text-xs font-bold text-[var(--crm-text-muted)]">{getCallReviewFramework(call.reviewWorkflow.framework)?.label || 'Jr. Acquisitions Scorecard'}</span>
                  {call.reviewWorkflow.status === 'completed' ? (
                    <button type="button" onClick={() => setViewingCompleted(call)} className="crm-secondary-button inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-black">
                      View Review
                    </button>
                  ) : (
                    <button disabled={busy} onClick={() => openReview(call)} className="crm-primary-button h-9 rounded-md px-3 text-xs font-black">
                      Score Call
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      {viewingCompleted ? <CompletedScorecardOverlay call={viewingCompleted} onClose={() => setViewingCompleted(null)} /> : null}
      {reviewing && framework ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <section role="dialog" aria-modal="true" aria-labelledby="scorecard-title" className="h-full w-full max-w-[760px] overflow-y-auto bg-[var(--crm-surface)] p-5 shadow-2xl">
            <div className="flex justify-between">
              <div>
                <p className="crm-eyebrow">{framework.label}</p>
                <h2 id="scorecard-title" className="text-2xl font-black">
                  {reviewing.leadName}
                </h2>
                <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Rate every behavior from 0 to 3.</p>
              </div>
              <button aria-label="Close scorecard" onClick={closeReview} className="crm-icon-button h-9 w-9 rounded-lg">
                <Icon name="close" />
              </button>
            </div>
            <audio ref={originalAudioRef} controls={!recordingVoiceover} src={reviewing.recordingUrl} onTimeUpdate={(event) => setCallPosition(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setCallDuration(event.currentTarget.duration)} onEnded={handleCallEnded} className="mt-4 w-full" />
            {recordingVoiceover ? (
              <div className="mt-3 rounded-xl border border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-[var(--crm-brand)]">Review Mode</p>
                    <p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">{reviewMode === 'call' ? 'The seller call is playing. Your microphone is muted.' : 'The call is paused. Your coaching commentary is recording.'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Review recording</p>
                    <p aria-label="Review recording elapsed time" className="font-mono text-lg font-black text-[var(--crm-brand)]">
                      {formatDuration(reviewElapsed)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">
                  <span>Call position</span>
                  <span>
                    {formatDuration(Math.floor(callPosition))} / {formatDuration(Math.floor(callDuration || 0))}
                  </span>
                </div>
                <input
                  aria-label="Call position"
                  type="range"
                  min={0}
                  max={Math.max(callDuration, 1)}
                  step={0.1}
                  value={callPosition}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (originalAudioRef.current) originalAudioRef.current.currentTime = value
                    setCallPosition(value)
                  }}
                  className="mt-2 w-full"
                />
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {reviewMode === 'call' ? (
                    <button type="button" onClick={pauseAndComment} className="crm-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black">
                      <Icon name="mic" />
                      Pause & Comment
                    </button>
                  ) : (
                    <button type="button" onClick={() => void resumeCall()} className="crm-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black">
                      <Icon name="play_arrow" />
                      Resume Call
                    </button>
                  )}
                  <button type="button" onClick={stopVoiceover} className="crm-secondary-button inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black">
                    <Icon name="stop_circle" />
                    Finish Review
                  </button>
                </div>
              </div>
            ) : (
              <div className={`mt-3 rounded-xl border p-3 ${voiceoverBlob ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)]' : 'border-[var(--crm-border)]'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={`flex items-center gap-2 text-xs font-black ${voiceoverBlob ? 'text-[var(--crm-success)]' : ''}`}>
                      {voiceoverBlob ? <Icon name="check_circle" /> : null}
                      {voiceoverBlob ? 'Review recording complete' : 'Guided voice review'}
                    </p>
                    <p className="text-[11px] text-[var(--crm-text-muted)]">{voiceoverBlob ? `${formatDuration(reviewElapsed)} recorded. Preview it below, then complete the scorecard to attach it.` : 'The call plays automatically. Pause it to comment, then resume when ready.'}</p>
                  </div>
                  <button type="button" onClick={() => void startVoiceover()} className="crm-secondary-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black">
                    <Icon name="mic" />
                    {voiceoverBlob ? 'Record Again' : 'Start Review'}
                  </button>
                </div>
                {voiceoverUrl ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Completed coaching review</p>
                    <audio aria-label="Completed coaching review preview" controls src={voiceoverUrl} className="w-full" />
                  </div>
                ) : null}
              </div>
            )}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {CALL_SCORE_RUBRIC.map((level) => (
                <div key={level.value} className="rounded-lg border border-[var(--crm-border)] p-2">
                  <strong className="text-xs">
                    {level.value} - {level.label}
                  </strong>
                  <p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">{level.description}</p>
                </div>
              ))}
            </div>
            {reviewing.analysisSummary ? <p className="mt-3 rounded-lg bg-[var(--crm-info-soft)] p-3 text-sm">{reviewing.analysisSummary}</p> : null}
            <div className="mt-3 rounded-xl border border-[var(--crm-border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black">AI pre-score</p>
                  <p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">{reviewing.reviewWorkflow.aiStatus === 'ready' ? 'Prefilled from the transcript. Your corrections become the final score.' : reviewing.reviewWorkflow.aiStatus === 'processing' ? 'Transcript analysis is still processing. Score manually or reopen shortly.' : reviewing.reviewWorkflow.aiStatus === 'failed' ? reviewing.reviewWorkflow.aiError || 'AI pre-score was unavailable. Score manually.' : 'No AI pre-score is available. Score manually.'}</p>
                </div>
                {reviewing.reviewWorkflow.aiStatus === 'ready' ? (
                  <strong className="rounded-full bg-[var(--crm-info-soft)] px-3 py-1 text-xs text-[var(--crm-info)]">{reviewing.reviewWorkflow.aiScore?.toFixed(2) || '0.00'} / 3</strong>
                ) : reviewing.reviewWorkflow.aiStatus === 'failed' && !reviewing.previewLocal ? (
                  <button type="button" disabled={busy} onClick={() => void retryAiScore(reviewing)} className="crm-secondary-button h-9 rounded-lg px-3 text-xs font-black">
                    Retry AI score
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-5 space-y-5">
              {framework.sections.map((section) => (
                <fieldset key={section.label}>
                  <legend className="mb-2 text-sm font-black">{section.label}</legend>
                  <div className="space-y-2">
                    {section.items.map((item) => {
                      const assessment = reviewing.reviewWorkflow.aiAnswers?.[item.id]
                      const corrected = assessment && ratings[item.id] !== assessment.score
                      return (
                        <div key={item.id} className="grid items-center gap-3 rounded-lg border border-[var(--crm-border)] p-3 sm:grid-cols-[minmax(0,1fr)_240px]">
                          <div>
                            <span className="text-sm font-semibold">{item.label}</span>
                            {assessment ? (
                              <div className="mt-1 text-[10px] leading-4 text-[var(--crm-text-muted)]">
                                <span className="font-black uppercase tracking-wide">
                                  AI {assessment.score} · {assessment.confidence} confidence
                                </span>
                                {corrected ? <span className="ml-2 font-black text-[var(--crm-brand)]">Corrected</span> : null}
                                <p>{assessment.evidence ? `“${assessment.evidence}”` : assessment.reasoning}</p>
                              </div>
                            ) : null}
                          </div>
                          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={item.label}>
                            {CALL_SCORE_RUBRIC.map((level) => (
                              <label key={level.value} className={`cursor-pointer rounded-md border px-2 py-2 text-center text-xs font-black ${ratings[item.id] === level.value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)]'}`}>
                                <input
                                  className="sr-only"
                                  type="radio"
                                  name={item.id}
                                  value={level.value}
                                  checked={ratings[item.id] === level.value}
                                  onChange={() =>
                                    setRatings((current) => ({
                                      ...current,
                                      [item.id]: level.value,
                                    }))
                                  }
                                />
                                {level.value}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            <label className="mt-5 block text-xs font-black">
              Coaching note
              <textarea value={note} onChange={(event) => setNote(event.target.value)} className="crm-field mt-2 min-h-24 w-full rounded-lg p-3 text-sm font-normal" />
            </label>
            <div className="sticky bottom-0 mt-5 flex items-center justify-between border-t border-[var(--crm-border)] bg-[var(--crm-surface)] py-4">
              <strong>{liveScore} / 3</strong>
              <button disabled={busy || recordingVoiceover || Object.keys(ratings).length !== itemCount} onClick={() => void completeReview(reviewing)} className="crm-primary-button rounded-lg px-5 py-3 text-sm font-black">
                Complete Scorecard
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
