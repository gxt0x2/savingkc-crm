'use client'

import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import {
  ANDON_ISSUE_KINDS,
  ANDON_KIND_LABELS,
  ANDON_PROCESS_CASCADES,
  ANDON_WORK_AREAS,
  extractAndonRecordContext,
  type AndonIssueKind,
  type AndonPriority,
  type AndonWorkArea,
} from '@/lib/andon'
import {
  ANDON_ATTACHMENT_ACCEPT,
  ANDON_ATTACHMENTS_BUCKET,
  MAX_ANDON_ATTACHMENTS,
  formatAndonAttachmentBytes,
  validateAndonAttachment,
} from '@/lib/andon-attachments'

interface Props {
  defaultSection?: string
  onClose: () => void
  onSubmit: () => void
}

const KIND_ICONS: Record<AndonIssueKind, string> = {
  process: 'account_tree',
  system: 'bug_report',
  data: 'database',
  improvement: 'lightbulb',
  ai_glitch: 'smart_toy',
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function voiceMemoExtension(mimeType: string) {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function defaultsForContext(context: string): { kind: AndonIssueKind; workstream: AndonWorkArea; category: string } {
  if (context === 'Google Ads') return { kind: 'process', workstream: 'Marketing', category: 'PPC Landing Page' }
  if (context === 'Dispositions / Closing') return { kind: 'process', workstream: 'Dispositions', category: 'Cash Buyer Email Blast' }
  if (['Contacts', 'Lead details', 'Conversations', 'Dialer', 'Calendar', 'Tasks'].includes(context)) {
    return { kind: 'process', workstream: 'Acquisitions', category: 'AI Text Bot Sequence' }
  }
  if (context === 'Workflows') return { kind: 'system', workstream: 'Acquisitions', category: 'Callback Automation' }
  if (context === 'Integrations') return { kind: 'system', workstream: 'Marketing', category: 'Skip Tracing Sync' }
  if (['Dashboard', 'Reports'].includes(context)) return { kind: 'data', workstream: 'Marketing', category: 'List Import Error' }
  return { kind: 'system', workstream: 'Acquisitions', category: 'Cold Dialer Lag' }
}

export function FeedbackForm({ defaultSection = '', onClose, onSubmit }: Props) {
  const initial = defaultsForContext(defaultSection)
  const [issueKind, setIssueKind] = useState<AndonIssueKind>(initial.kind)
  const [workstream, setWorkstream] = useState(initial.workstream)
  const [category, setCategory] = useState(initial.category)
  const [description, setDescription] = useState('')
  const [fiveWhys, setFiveWhys] = useState(['', '', '', '', ''])
  const [priority, setPriority] = useState<AndonPriority>('medium')
  const [attachments, setAttachments] = useState<File[]>([])
  const [uploadedAttachmentKeys, setUploadedAttachmentKeys] = useState<string[]>([])
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<File[]>([])
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderStreamRef = useRef<MediaStream | null>(null)
  const recorderChunksRef = useRef<Blob[]>([])

  const categories = ANDON_PROCESS_CASCADES[workstream] ?? []

  useEffect(() => {
    if (!isRecording) return
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isRecording])

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.ondataavailable = null
      recorderRef.current.onstop = null
      if (recorderRef.current.state === 'recording') recorderRef.current.stop()
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  function chooseKind(nextKind: AndonIssueKind) {
    setIssueKind(nextKind)
  }

  function chooseWorkstream(nextWorkstream: AndonWorkArea) {
    setWorkstream(nextWorkstream)
    setCategory(ANDON_PROCESS_CASCADES[nextWorkstream]?.[0] ?? '')
  }

  function updateWhy(index: number, value: string) {
    setFiveWhys((current) => current.map((why, whyIndex) => whyIndex === index ? value : why))
  }

  function addAttachments(files: File[]) {
    setError('')
    const next = [...attachmentsRef.current]
    const existing = new Set(next.map(fileKey))
    for (const file of files) {
      const validationError = validateAndonAttachment(file)
      if (validationError) {
        setError(validationError)
        continue
      }
      if (existing.has(fileKey(file))) continue
      if (next.length >= MAX_ANDON_ATTACHMENTS) {
        setError(`You can attach up to ${MAX_ANDON_ATTACHMENTS} files to one Andon.`)
        break
      }
      next.push(file)
      existing.add(fileKey(file))
    }
    attachmentsRef.current = next
    setAttachments(next)
  }

  function removeAttachment(key: string) {
    if (uploadedAttachmentKeys.includes(key)) return
    const next = attachmentsRef.current.filter((file) => fileKey(file) !== key)
    attachmentsRef.current = next
    setAttachments(next)
  }

  async function startVoiceMemo() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser. You can attach an existing audio file instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
      const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
        ? preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type))
        : undefined
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderStreamRef.current = stream
      recorderRef.current = recorder
      recorderChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const recordedType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(recorderChunksRef.current, { type: recordedType })
        if (blob.size > 0) {
          const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
          addAttachments([new File([blob], `voice-memo-${timestamp}.${voiceMemoExtension(recordedType)}`, { type: recordedType })])
        }
        stream.getTracks().forEach((track) => track.stop())
        recorderRef.current = null
        recorderStreamRef.current = null
        recorderChunksRef.current = []
        setIsRecording(false)
      }
      recorder.start()
      setRecordingSeconds(0)
      setIsRecording(true)
    } catch (recordingError) {
      console.error('Voice memo recording failed:', recordingError)
      setError('Microphone access was not available. You can attach an existing voice memo instead.')
    }
  }

  function stopVoiceMemo() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  async function uploadAttachment(feedbackId: string, file: File) {
    const prepareResponse = await fetch(`/api/feedback/${feedbackId}/attachments/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime_type: file.type, byte_size: file.size }),
    })
    const prepared = await prepareResponse.json().catch(() => null) as { error?: string; path?: string; token?: string; bucket?: string } | null
    if (!prepareResponse.ok || !prepared?.path || !prepared.token) {
      throw new Error(prepared?.error || `${file.name} could not be prepared for upload.`)
    }

    const { createClient } = await import('@/lib/supabase/client')
    const storage = createClient().storage.from(prepared.bucket || ANDON_ATTACHMENTS_BUCKET)
    const { error: uploadError } = await storage.uploadToSignedUrl(prepared.path, prepared.token, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
    if (uploadError) throw new Error(`${file.name} could not be uploaded: ${uploadError.message}`)

    const completeResponse = await fetch(`/api/feedback/${feedbackId}/attachments/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type,
        byte_size: file.size,
        storage_path: prepared.path,
      }),
    })
    const completed = await completeResponse.json().catch(() => null) as { error?: string } | null
    if (!completeResponse.ok) throw new Error(completed?.error || `${file.name} could not be linked to the Andon.`)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!description.trim() || !workstream || !category) return

    setLoading(true)
    setError('')
    let andonAlreadyRaised = Boolean(submittedId)
    try {
      let feedbackId = submittedId
      if (!feedbackId) {
        const recordContext = extractAndonRecordContext(window.location.href)
        const response = await fetch('/api/feedback/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issue_kind: issueKind,
            department: workstream,
            category,
            description,
            five_whys: fiveWhys,
            priority,
            page_url: window.location.href,
            record_id: recordContext.recordId,
            record_type: recordContext.recordType,
            record_url: recordContext.recordUrl,
            user_agent: navigator.userAgent,
          }),
        })

        const payload = await response.json().catch(() => null) as { error?: string; feedback_id?: string } | null
        if (!response.ok || !payload?.feedback_id) {
          throw new Error(payload?.error || 'The Andon could not be submitted. Please try again.')
        }
        feedbackId = payload.feedback_id
        setSubmittedId(feedbackId)
        andonAlreadyRaised = true
      }

      const completedKeys = new Set(uploadedAttachmentKeys)
      const pending = attachments.filter((file) => !completedKeys.has(fileKey(file)))
      for (let index = 0; index < pending.length; index += 1) {
        const file = pending[index]
        setUploadProgress(`Uploading ${index + 1} of ${pending.length}: ${file.name}`)
        await uploadAttachment(feedbackId, file)
        completedKeys.add(fileKey(file))
        setUploadedAttachmentKeys([...completedKeys])
      }
      setUploadProgress('')
      onSubmit()
      onClose()
    } catch (err) {
      console.error('Failed to submit Andon:', err)
      setUploadProgress('')
      const message = err instanceof Error ? err.message : 'The Andon could not be submitted. Please try again.'
      setError(andonAlreadyRaised ? `The Andon was raised, but an attachment failed. ${message} Retry the remaining attachments or close.` : message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="andon-title" className="crm-panel max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 text-[var(--crm-ink)] shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]"><Icon name="warning_amber" className="text-[24px]" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-danger)]">System Andon</p><h2 id="andon-title" className="text-xl font-black">Report an issue</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Identify the issue, route it once, and preserve the root-cause trail.</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Andon form" className="crm-icon-button flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"><Icon name="close" size="text-lg" /></button>
        </div>

        <form
          onSubmit={handleSubmit}
          onPaste={(event) => {
            const pastedFiles = Array.from(event.clipboardData.files)
            if (pastedFiles.length > 0) {
              event.preventDefault()
              addAttachments(pastedFiles)
            }
          }}
          className="space-y-4"
        >
          <fieldset>
            <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">1. What needs attention?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ANDON_ISSUE_KINDS.map((kind) => (
                <button key={kind} type="button" aria-pressed={issueKind === kind} onClick={() => chooseKind(kind)} className={`rounded-xl border px-2 py-3 text-xs font-bold transition-colors ${issueKind === kind ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-border-strong)]'}`}>
                  <Icon name={KIND_ICONS[kind]} className="mr-1.5 inline text-[17px]" />{ANDON_KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              2. Core work area
              <select aria-label="Core work area" value={workstream} onChange={(event) => chooseWorkstream(event.target.value as AndonWorkArea)} required className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25">
                {ANDON_WORK_AREAS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
              3. Specific process
              <select aria-label="Specific process" value={category} onChange={(event) => setCategory(event.target.value)} required className="crm-field mt-2 h-11 w-full rounded-lg px-3 text-sm font-semibold normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25">
                {categories.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">4. Impact</legend>
            <div className="grid grid-cols-4 gap-2">
              {(['low', 'medium', 'high', 'critical'] as const).map((level) => <button key={level} type="button" aria-pressed={priority === level} onClick={() => setPriority(level)} className={`rounded-lg border px-2 py-2 text-xs font-semibold capitalize transition-colors ${priority === level ? 'border-[var(--crm-danger)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-border)] hover:border-[var(--crm-border-strong)]'}`}>{level}</button>)}
            </div>
          </fieldset>

          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
            5. What happened?
            <textarea aria-label="What happened" value={description} onChange={(event) => setDescription(event.target.value)} required rows={4} placeholder="What were you doing, what happened, and what should have happened?" className="crm-field mt-2 w-full resize-y rounded-lg px-3 py-2 text-sm font-medium normal-case tracking-normal outline-none focus:ring-2 focus:ring-[var(--crm-info)]/25" />
          </label>

          <section className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--crm-ink)]">6. Attach evidence <span className="font-medium normal-case tracking-normal text-[var(--crm-text-muted)]">- optional</span></h3>
                <p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">Files, screenshots, images, videos, audio, or voice memos · up to 8 files · 50 MB each</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={loading || isRecording} onClick={() => fileInputRef.current?.click()} className="crm-secondary-button inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-50"><Icon name="attach_file" />Add files</button>
                {isRecording ? <button type="button" onClick={stopVoiceMemo} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--crm-danger)] px-3 py-2 text-xs font-black text-white"><Icon name="stop_circle" />Stop {recordingSeconds}s</button> : <button type="button" disabled={loading} onClick={() => void startVoiceMemo()} className="crm-secondary-button inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-50"><Icon name="mic" />Voice memo</button>}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ANDON_ATTACHMENT_ACCEPT}
              aria-label="Attach evidence"
              className="sr-only"
              onChange={(event) => {
                addAttachments(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                addAttachments(Array.from(event.dataTransfer.files))
              }}
              className="mt-3 rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-3 text-center text-[11px] font-semibold text-[var(--crm-text-muted)]"
            >
              Drop files here, paste a screenshot, choose files, or record a voice memo.
            </div>
            {attachments.length > 0 ? <ul aria-label="Selected Andon attachments" className="mt-3 space-y-2">{attachments.map((file) => {
              const key = fileKey(file)
              const uploaded = uploadedAttachmentKeys.includes(key)
              return <li key={key} className="flex items-center gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 text-xs"><Icon name={file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'videocam' : file.type.startsWith('audio/') ? 'audio_file' : 'description'} className="shrink-0 text-[var(--crm-info)]" /><span className="min-w-0 flex-1"><strong className="block truncate">{file.name}</strong><span className="text-[10px] text-[var(--crm-text-muted)]">{formatAndonAttachmentBytes(file.size)}{uploaded ? ' · uploaded' : ''}</span></span>{uploaded ? <Icon name="check_circle" className="text-[var(--crm-success)]" /> : <button type="button" aria-label={`Remove ${file.name}`} disabled={loading} onClick={() => removeAttachment(key)} className="crm-icon-button grid h-7 w-7 place-items-center rounded-md disabled:opacity-50"><Icon name="close" className="text-sm" /></button>}</li>
            })}</ul> : null}
            {uploadProgress ? <div role="status" className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--crm-info)]"><Icon name="progress_activity" className="animate-spin" />{uploadProgress}</div> : null}
          </section>

          <details className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3" open>
            <summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-[var(--crm-ink)]">7. Five Whys <span className="font-medium normal-case tracking-normal text-[var(--crm-text-muted)]">- add what is known now</span></summary>
            <p className="mb-3 mt-1 text-[11px] text-[var(--crm-text-muted)]">Each answer should explain the answer above it. Missing answers stay visible on the Andon dashboard for follow-up.</p>
            <div className="space-y-2">
              {fiveWhys.map((why, index) => <label key={index} className="grid items-center gap-2 text-xs font-bold sm:grid-cols-[58px_1fr]"><span>Why {index + 1}</span><input aria-label={`Why ${index + 1}`} value={why} onChange={(event) => updateWhy(index, event.target.value)} placeholder={index === 0 ? 'Why did it happen?' : 'Why was that true?'} className="crm-field h-9 rounded-lg px-3 text-xs font-medium" /></label>)}
            </div>
          </details>

          <div className="rounded-lg bg-[var(--crm-info-soft)] p-3 text-xs text-[var(--crm-text-muted)]"><Icon name="info" size="text-sm" className="mr-1 inline text-[var(--crm-info)]" /><strong>Included automatically:</strong> exact CRM record URL, Lead or Property ID when present, timestamp, signed-in agent, and browser.</div>
          {error ? <div role="alert" className="rounded-lg border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="crm-secondary-button flex-1 rounded-xl px-6 py-3 text-sm font-bold">{submittedId ? 'Close' : 'Cancel'}</button>
            <button type="submit" disabled={loading || isRecording || !description.trim() || !workstream || !category} className="flex-1 rounded-xl bg-[var(--crm-danger)] px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-95 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">{loading ? (uploadProgress || 'Sending Andon…') : submittedId ? 'Retry attachments' : 'Raise Andon'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
