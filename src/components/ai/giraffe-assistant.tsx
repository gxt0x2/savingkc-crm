'use client'

import Image from 'next/image'
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'

type Message = { role: 'user' | 'assistant'; content: string; attachments?: string[] }
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

const INTRO: Message = {
  role: 'assistant',
  content: "I start with SavingKC's recorded goals, current performance, and approved operating path. I'll identify what is off track, recommend the highest-leverage next action, and prepare safe implementation steps. Ask a question, dictate it, or attach evidence.",
}

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

export function GiraffeAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([INTRO])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [dictationAvailable, setDictationAvailable] = useState(false)
  const [error, setError] = useState('')
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
    if (typeof window === 'undefined') return
    const browserWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    setDictationAvailable(Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition))
    return () => recognitionRef.current?.stop()
  }, [])

  async function sendPrompt(prompt: string) {
    const clean = prompt.trim() || (attachments.length > 0 ? "Review the attached evidence through SavingKC's goals and operating path." : '')
    if (!clean || sending) return
    const requestAttachments = attachments
    const priorMessages = messages
    const next = [...messages, { role: 'user' as const, content: clean, attachments: requestAttachments.map((attachment) => attachment.name) }]
    setMessages(next)
    setInput('')
    setAttachments([])
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/ai/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          attachments: requestAttachments.map(({ name, mediaType, size, dataUrl }) => ({ name, mediaType, size, dataUrl })),
        }),
      })
      const data = await response.json().catch(() => ({})) as { reply?: string; error?: string }
      if (!response.ok) throw new Error(data.error || 'The AI Assistant could not complete the request.')
      setMessages((current) => [...current, { role: 'assistant', content: data.reply || 'No response was returned.' }])
    } catch (cause) {
      setMessages(priorMessages)
      setInput(clean)
      setAttachments(requestAttachments)
      setError(cause instanceof Error ? cause.message : 'The AI Assistant could not complete the request.')
    } finally {
      setSending(false)
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
    <div className="fixed bottom-5 right-5 z-[90] flex flex-col items-end gap-3">
      {open ? (
        <section role="dialog" aria-modal="false" aria-label="AI Assistant" className="crm-panel-raised flex h-[min(660px,calc(100vh-110px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl shadow-2xl">
          <header className="flex items-center gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3">
            <Image src="/ai/giraffe-assistant.webp" alt="" width={48} height={48} className="h-11 w-11 rounded-full border-2 border-[var(--crm-warning-border)] object-cover" />
            <div className="min-w-0 flex-1"><h2 className="font-black text-[var(--crm-ink)]">AI Assistant</h2><p className="text-[11px] font-semibold text-[var(--crm-success)]">Company goals + live CRM context</p></div>
            <button type="button" onClick={() => setOpen(false)} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Close AI Assistant"><Icon name="close" /></button>
          </header>
          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--crm-surface-subtle)] p-4">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 shadow-sm ${message.role === 'user' ? 'rounded-br-md bg-[var(--crm-brand)] text-white' : 'rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-ink)]'}`}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.attachments?.length ? <div className="mt-2 flex flex-wrap gap-1">{message.attachments.map((name) => <span key={name} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold">{name}</span>)}</div> : null}
                </div>
              </div>
            ))}
            {sending ? <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3.5 py-2.5 text-sm text-[var(--crm-text-muted)]">Checking goals, live CRM, and workflow path…</div></div> : null}
            {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
          </div>
          <form onSubmit={submit} className="border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
            {attachments.length ? <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached files">{attachments.map((attachment) => <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] py-1 pl-2.5 pr-1 text-[10px] font-bold"><span className="max-w-52 truncate">{attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))} aria-label={`Remove ${attachment.name}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-[var(--crm-surface)]"><Icon name="close" className="text-[13px]" /></button></span>)}</div> : null}
            <label htmlFor="giraffe-ai-request" className="sr-only">Ask the AI Assistant</label>
            <input ref={fileInputRef} type="file" multiple accept=".csv,.json,.md,.pdf,.txt,.xml,image/heic,image/jpeg,image/png,image/webp" onChange={(event) => void addAttachments(event)} className="sr-only" aria-label="Attach files to AI request" />
            <div className="rounded-xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 focus-within:border-[var(--crm-violet)]">
              <textarea id="giraffe-ai-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt(input) } }} placeholder="Ask what is off track, what happens next, or what to implement…" className="min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm text-[var(--crm-ink)] outline-none placeholder:text-[var(--crm-text-dim)]" />
              <div className="mt-1 flex items-center gap-1.5 border-t border-[var(--crm-border)] pt-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || attachments.length >= MAX_ATTACHMENTS} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40" aria-label="Attach evidence"><Icon name="attach_file" /></button>
                <button type="button" onClick={toggleDictation} disabled={sending || !dictationAvailable} className={`crm-icon-button grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40 ${listening ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : ''}`} aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'} aria-pressed={listening}><Icon name={listening ? 'mic_off' : 'mic'} /></button>
                <span aria-live="polite" className="min-w-0 flex-1 truncate pl-1 text-[9px] font-semibold text-[var(--crm-text-muted)]">{listening ? 'Listening…' : attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} ready` : 'Attach evidence or dictate'}</span>
                <button type="submit" disabled={(!input.trim() && attachments.length === 0) || sending} className="crm-primary-button grid h-10 w-10 shrink-0 place-items-center rounded-lg disabled:opacity-50" aria-label="Send AI request"><Icon name="arrow_upward" /></button>
              </div>
            </div>
            <p className="mt-1.5 text-[9px] text-[var(--crm-text-muted)]">Goals and approved operating paths are checked first. Changes affecting people, data, routing, or spend require confirmation.</p>
          </form>
        </section>
      ) : null}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Hide AI Assistant' : 'Open AI Assistant'} aria-expanded={open} className="relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border-2 border-[var(--crm-warning-border)] bg-[#fffdf8] shadow-[0_10px_30px_rgba(32,33,36,.28)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(32,33,36,.34)] focus:outline-none focus:ring-4 focus:ring-[var(--crm-violet-soft)]">
        <Image src="/ai/giraffe-assistant.webp" alt="AI Assistant giraffe" fill sizes="64px" className="object-cover" priority={false} />
        <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[var(--crm-success)]" />
      </button>
    </div>
  )
}
