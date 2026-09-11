'use client'

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'

import { AssistantMark } from '@/components/ai/assistant-mark'
import { AssistantMessage } from '@/components/ai/assistant-message'
import { Icon } from '@/components/ui/icon'
import { useAssistantThread } from '@/hooks/use-assistant-thread'

type AssistantAttachment = { id: string; name: string; mediaType: string; size: number; dataUrl: string }
type SpeechResultListLike = { length: number; [index: number]: { isFinal: boolean; 0: { transcript: string } } }
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

const MAX_ATTACHMENT_SIZE = 2_000_000
const MAX_TOTAL_ATTACHMENT_SIZE = 3_000_000
const MAX_ATTACHMENTS = 3
const ACCEPTED_MEDIA_TYPES = new Set([
  'application/json',
  'application/pdf',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/xml',
])

const INTRO = "Ask one clear question. I'll lead with the answer, show the next move, and keep supporting detail tucked away until you need it."

function mediaTypeFor(file: File) {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'md') return 'text/markdown'
  if (extension === 'csv') return 'text/csv'
  if (extension === 'json') return 'application/json'
  if (extension === 'txt') return 'text/plain'
  return ''
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`${file.name} could not be read.`))
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
    reader.readAsDataURL(file)
  })
}

export function GiraffeAssistant({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const { messages, loadingHistory, sending, error, setError, send, clear, ownerEmail } = useAssistantThread('giraffe')
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([])
  const [listening, setListening] = useState(false)
  const [dictationAvailable] = useState(() => {
    if (typeof window === 'undefined') return false
    const browserWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    return Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition)
  })
  const transcriptRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const dictationBaseRef = useRef('')

  useEffect(() => {
    if (!open) return
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, open, sending])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  async function sendPrompt(prompt: string) {
    const clean = prompt.trim() || (attachments.length > 0 ? "Review the attached evidence through SavingKC's goals and operating path." : '')
    if (!clean || sending || loadingHistory) return
    const requestAttachments = attachments
    setInput('')
    setAttachments([])
    setError('')
    const sent = await send(clean, requestAttachments.map(({ name, mediaType, size, dataUrl }) => ({ name, mediaType, size, dataUrl })))
    if (!sent) {
      setInput(clean)
      setAttachments(requestAttachments)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void sendPrompt(input)
  }

  async function addAttachments(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length === 0) return
    setError('')
    try {
      if (attachments.length + selected.length > MAX_ATTACHMENTS) throw new Error(`Attach up to ${MAX_ATTACHMENTS} files at a time.`)
      const selectedSize = selected.reduce((sum, file) => sum + file.size, 0)
      const currentSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
      if (currentSize + selectedSize > MAX_TOTAL_ATTACHMENT_SIZE) throw new Error('Attachments exceed the 3 MB request limit.')
      const additions = await Promise.all(selected.map(async (file) => {
        const mediaType = mediaTypeFor(file)
        if (!ACCEPTED_MEDIA_TYPES.has(mediaType)) throw new Error(`${file.name} is not a supported attachment type.`)
        if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name} is larger than the 2 MB attachment limit.`)
        return { id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, name: file.name, mediaType, size: file.size, dataUrl: await readAsDataUrl(file) }
      }))
      setAttachments((current) => [...current, ...additions])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected file could not be attached.')
    }
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const browserWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition
    if (!Recognition) {
      setError('Voice dictation is not supported in this browser.')
      return
    }
    setError('')
    dictationBaseRef.current = input.trim()
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let spoken = ''
      for (let index = 0; index < event.results.length; index += 1) spoken += event.results[index][0]?.transcript || ''
      setInput([dictationBaseRef.current, spoken.trim()].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      setListening(false)
      setError(event.error === 'not-allowed' ? 'Microphone access was denied. Allow microphone access to dictate.' : `Voice dictation stopped: ${event.error}.`)
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

  return (
    <div className={open ? 'fixed inset-0 z-[90] flex flex-col items-end lg:inset-auto lg:bottom-5 lg:right-5 lg:gap-3' : 'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-[50] flex flex-col items-end gap-3 lg:bottom-5 lg:right-5 lg:z-[90]'}>
      {open ? (
        <section role="dialog" aria-modal="true" aria-label="SavingKC Intelligence" className="crm-panel-raised flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-none shadow-[0_24px_80px_rgba(13,15,13,.28)] lg:h-[min(760px,calc(100dvh-72px))] lg:w-[min(520px,calc(100vw-32px))] lg:rounded-[22px]">
          <header className="flex items-center gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))] lg:px-5 lg:py-4">
            <AssistantMark live className="h-11 w-11 rounded-[14px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><h2 className="truncate text-sm font-black tracking-tight text-[var(--crm-ink)]">SavingKC Intelligence</h2><span className="rounded-full bg-[var(--crm-brand-soft)] px-2 py-0.5 text-[8px] font-black uppercase tracking-[.14em] text-[var(--crm-brand)]">Live</span></div>
              <p className="mt-0.5 truncate text-[10px] font-semibold text-[var(--crm-text-muted)]">Private{ownerEmail ? ` to ${ownerEmail}` : ' to your account'} · live CRM context</p>
            </div>
            <button type="button" onClick={() => void clear()} disabled={sending || loadingHistory} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40" aria-label="Start a new AI conversation"><Icon name="edit_square" /></button>
            <button type="button" onClick={() => setOpen(false)} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Close SavingKC Intelligence"><Icon name="close" /></button>
          </header>
          <div ref={transcriptRef} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto bg-[var(--crm-canvas)] px-4 py-5 lg:px-5">
            {loadingHistory ? <div className="flex items-center gap-2 text-xs font-semibold text-[var(--crm-text-muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--crm-brand)]" />Loading this conversation…</div> : null}
            {!loadingHistory && messages.length === 0 ? (
              <div className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[var(--crm-brand)]">Built for decisions</p>
                <p className="mt-2 max-w-[44ch] text-sm font-semibold leading-6 text-[var(--crm-ink)]">{INTRO}</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black text-[var(--crm-text-muted)]"><span className="rounded-lg bg-[var(--crm-surface-subtle)] px-2.5 py-2">Live CRM context</span><span className="rounded-lg bg-[var(--crm-surface-subtle)] px-2.5 py-2">Evidence on demand</span></div>
              </div>
            ) : null}
            {messages.map((message) => (
              message.role === 'user' ? (
                <div key={message.id} className="flex min-w-0 justify-end pl-8">
                  <div className="min-w-0 max-w-[88%] rounded-2xl rounded-br-md bg-[#292d2a] px-3.5 py-2.5 text-[13px] leading-5 text-white shadow-sm ring-1 ring-white/10">
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
                    {message.attachments.length ? <div className="mt-2 flex flex-wrap gap-1">{message.attachments.map((attachment) => <span key={attachment.name} className="max-w-full truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold">{attachment.name}</span>)}</div> : null}
                  </div>
                </div>
              ) : (
                <article key={message.id} className="min-w-0 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_8px_26px_rgba(18,21,18,.05)]">
                  <div className="flex items-center gap-2 border-b border-[var(--crm-border)] px-4 py-2.5"><AssistantMark className="h-6 w-6 rounded-lg" /><span className="text-[9px] font-black uppercase tracking-[.14em] text-[var(--crm-text-muted)]">Intelligence brief</span></div>
                  <div className="min-w-0 max-w-full px-4 py-3.5"><AssistantMessage content={message.content} sources={message.sources} /></div>
                </article>
              )
            ))}
            {sending ? <div className="flex items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3.5 py-3 text-xs font-semibold text-[var(--crm-text-muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--crm-brand)]" />Reading the live CRM and deciding what matters…</div> : null}
            {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
          </div>
          <form onSubmit={submit} className="border-t border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 lg:px-4">
            {attachments.length ? <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached files">{attachments.map((attachment) => <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] py-1 pl-2.5 pr-1 text-[10px] font-bold"><span className="max-w-52 truncate">{attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))} aria-label={`Remove ${attachment.name}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-[var(--crm-surface)]"><Icon name="close" className="text-[13px]" /></button></span>)}</div> : null}
            <label htmlFor="giraffe-ai-request" className="sr-only">Ask SavingKC Intelligence</label>
            <input ref={fileInputRef} type="file" multiple accept=".csv,.json,.md,.pdf,.txt,.xml,image/heic,image/jpeg,image/png,image/webp" onChange={(event) => void addAttachments(event)} className="sr-only" aria-label="Attach files to AI request" />
            <div className="rounded-2xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 shadow-[0_8px_24px_rgba(18,21,18,.06)] focus-within:border-[var(--crm-brand)] focus-within:ring-2 focus-within:ring-[var(--crm-brand-soft)]">
              <textarea id="giraffe-ai-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt(input) } }} placeholder="Ask the next important question…" className="min-h-12 w-full resize-none bg-transparent px-1 py-1 text-base text-[var(--crm-ink)] outline-none placeholder:text-[var(--crm-text-dim)]" />
              <div className="mt-1 flex items-center gap-1.5 border-t border-[var(--crm-border)] pt-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || loadingHistory || attachments.length >= MAX_ATTACHMENTS} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40" aria-label="Attach evidence"><Icon name="attach_file" /></button>
                <button type="button" onClick={toggleDictation} disabled={sending || loadingHistory || !dictationAvailable} className={`crm-icon-button grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40 ${listening ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : ''}`} aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'} aria-pressed={listening}><Icon name={listening ? 'mic_off' : 'mic'} /></button>
                <span aria-live="polite" className="min-w-0 flex-1 truncate pl-1 text-[9px] font-semibold text-[var(--crm-text-muted)]">{listening ? 'Listening…' : attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready` : 'Attach evidence or dictate'}</span>
                <button type="submit" disabled={(!input.trim() && attachments.length === 0) || sending || loadingHistory} className="crm-primary-button grid h-10 w-10 shrink-0 place-items-center rounded-lg disabled:opacity-50" aria-label="Send AI request"><Icon name="arrow_upward" /></button>
              </div>
            </div>
            <p className="mt-1.5 px-1 text-[9px] text-[var(--crm-text-muted)]">Live context first. Consequential changes always wait for your confirmation.</p>
          </form>
        </section>
      ) : null}
      {!open ? <button type="button" onClick={() => setOpen(true)} aria-label="Open SavingKC Intelligence" aria-expanded={false} className="relative hidden h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-[#171916] shadow-[0_14px_36px_rgba(16,18,16,.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(16,18,16,.34)] focus:outline-none focus:ring-4 focus:ring-[var(--crm-brand-soft)] lg:grid">
        <AssistantMark live className="h-full w-full rounded-2xl" />
      </button> : null}
    </div>
  )
}
