'use client'

import { useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'

type SpeechResultListLike = { length: number; [index: number]: { 0: { transcript: string } } }
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: SpeechResultListLike }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const browserWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null
}

export function ContactNoteComposer({
  contactName,
  onSave,
  readOnlyPreview = false,
  rows = 1,
  variant = 'compact',
  fillAvailable = false,
}: {
  contactName: string
  onSave: (description: string) => Promise<void>
  readOnlyPreview?: boolean
  rows?: number
  variant?: 'compact' | 'workspace'
  fillAvailable?: boolean
}) {
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [dictationAvailable] = useState(() => Boolean(speechRecognitionConstructor()))
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const dictationBaseRef = useRef('')

  useEffect(() => () => recognitionRef.current?.stop(), [])

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const Recognition = speechRecognitionConstructor()
    if (!Recognition) {
      setError('Voice dictation is not supported in this browser.')
      return
    }
    setError(null)
    setStatus('idle')
    dictationBaseRef.current = note.trim()
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let spoken = ''
      for (let index = 0; index < event.results.length; index += 1) spoken += event.results[index]?.[0]?.transcript || ''
      setNote([dictationBaseRef.current, spoken.trim()].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      setListening(false)
      setError(event.error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access to dictate a note.'
        : `Voice dictation stopped: ${event.error}.`)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setError('Voice dictation could not start. Try again.')
    }
  }

  async function submit() {
    const description = note.trim()
    if (readOnlyPreview || !description || status === 'saving' || listening) return
    setStatus('saving')
    setError(null)
    try {
      await onSave(description)
      setNote('')
      setStatus('saved')
    } catch (saveError) {
      setStatus('idle')
      setError(saveError instanceof Error ? saveError.message : 'Could not save contact note')
    }
  }

  if (variant === 'workspace') return <div className={fillAvailable ? 'mt-4 flex min-h-0 flex-1 flex-col' : 'mt-4'}>
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} className={fillAvailable ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <label className={fillAvailable ? 'flex min-h-0 flex-1 flex-col' : 'block'}>
        <span className="mb-2 block text-[11px] font-medium text-[var(--ck-text-muted)]">Call notes</span>
        <textarea
          aria-label={`Note for ${contactName}`}
          value={note}
          onChange={(event) => { setNote(event.target.value); setStatus('idle'); setError(null) }}
          rows={rows}
          maxLength={2_000}
          disabled={readOnlyPreview}
          placeholder="Type what you learn during the conversation..."
          className={`${fillAvailable ? 'min-h-[12rem] flex-1 resize-none' : 'min-h-[98px] resize-y'} w-full rounded-lg border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] px-3 py-2 text-xs leading-5 text-[var(--ck-text)] outline-none placeholder:text-[var(--ck-text-dim)] focus:border-[var(--prospecting-border-strong)] disabled:cursor-not-allowed`}
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" aria-label="Save note" disabled={readOnlyPreview || !note.trim() || status === 'saving' || listening} title={readOnlyPreview ? 'Available in a live calling session' : listening ? 'Stop dictation before saving' : undefined} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--prospecting-primary)] px-3 text-xs font-bold text-[var(--prospecting-on-primary)] transition-colors hover:bg-[var(--prospecting-primary-strong)] disabled:cursor-not-allowed">
          <Icon name={status === 'saving' ? 'progress_activity' : 'save'} size="text-sm" className={status === 'saving' ? 'animate-spin' : ''} />
          {status === 'saving' ? 'Saving…' : 'Save Note'}
        </button>
        <button type="button" onClick={toggleDictation} disabled={readOnlyPreview || status === 'saving' || !dictationAvailable} aria-label={listening ? 'Stop note dictation' : 'Start note dictation'} aria-pressed={listening} title={!dictationAvailable ? 'Voice dictation is not supported in this browser' : undefined} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${listening ? 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--prospecting-border-strong)] bg-[var(--prospecting-elevated)] text-[var(--ck-text)] hover:bg-[var(--prospecting-hover)]'}`}>
          <Icon name={listening ? 'mic_off' : 'mic'} size="text-sm" />
          {listening ? 'Stop dictation' : 'Dictate note'}
        </button>
        <span aria-live="polite" className="text-[10px] font-semibold text-[var(--ck-text-muted)]">{listening ? 'Listening… speak naturally.' : dictationAvailable ? 'Review the transcript before saving.' : 'Dictation unavailable in this browser.'}</span>
      </div>
    </form>
    {status === 'saved' ? <p role="status" className="mt-1.5 text-[10px] font-bold text-[var(--crm-success)]">Note saved to this contact.</p> : null}
    {error ? <p role="alert" className="mt-1.5 text-[10px] font-bold text-[var(--crm-danger)]">{error}</p> : null}
  </div>

  return <div className="mt-3 rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-2.5">
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Note for {contactName}</span>
        <textarea
          value={note}
          onChange={(event) => { setNote(event.target.value); setStatus('idle'); setError(null) }}
          rows={rows}
          maxLength={2_000}
          disabled={readOnlyPreview}
          placeholder={`Add a note for ${contactName}…`}
          className="crm-field min-h-10 w-full resize-y rounded-lg px-3 py-2 text-xs leading-5 disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
      <button type="submit" disabled={readOnlyPreview || !note.trim() || status === 'saving'} title={readOnlyPreview ? 'Available in a live calling session' : undefined} className="crm-secondary-button inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40">
        <Icon name={status === 'saving' ? 'progress_activity' : 'note_add'} size="text-sm" className={status === 'saving' ? 'animate-spin' : ''} />
        {status === 'saving' ? 'Saving…' : 'Save note'}
      </button>
    </form>
    {readOnlyPreview ? <p className="mt-1.5 text-[10px] font-bold text-[var(--crm-text-muted)]">Notes are visible for workflow review and save only during live calling.</p> : null}
    {status === 'saved' ? <p role="status" className="mt-1.5 text-[10px] font-bold text-[var(--crm-success)]">Note saved to this contact.</p> : null}
    {error ? <p role="alert" className="mt-1.5 text-[10px] font-bold text-[var(--crm-danger)]">{error}</p> : null}
  </div>
}
