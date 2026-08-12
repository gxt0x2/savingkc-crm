'use client'

import Image from 'next/image'
import { FormEvent, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'

type Message = { role: 'user' | 'assistant'; content: string }

const INTRO: Message = {
  role: 'assistant',
  content: 'Hi — I can inspect the CRM, explain a phone or workflow path, analyze performance, find a contact, or draft an operating change. What do you need?',
}

export function GiraffeAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([INTRO])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, open, sending])

  async function sendPrompt(prompt: string) {
    const clean = prompt.trim()
    if (!clean || sending) return
    const next = [...messages, { role: 'user' as const, content: clean }]
    setMessages(next)
    setInput('')
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/ai/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await response.json().catch(() => ({})) as { reply?: string; error?: string }
      if (!response.ok) throw new Error(data.error || 'The AI Assistant could not complete the request.')
      setMessages((current) => [...current, { role: 'assistant', content: data.reply || 'No response was returned.' }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The AI Assistant could not complete the request.')
    } finally {
      setSending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void sendPrompt(input)
  }

  return (
    <div className="fixed bottom-5 right-5 z-[90] flex flex-col items-end gap-3">
      {open ? (
        <section role="dialog" aria-modal="false" aria-label="AI Assistant" className="crm-panel-raised flex h-[min(620px,calc(100vh-110px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl shadow-2xl">
          <header className="flex items-center gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3">
            <Image src="/ai/giraffe-assistant.webp" alt="" width={48} height={48} className="h-11 w-11 rounded-full border-2 border-[var(--crm-warning-border)] object-cover" />
            <div className="min-w-0 flex-1"><h2 className="font-black text-[var(--crm-ink)]">AI Assistant</h2><p className="text-[11px] font-semibold text-[var(--crm-success)]">Live CRM context</p></div>
            <button type="button" onClick={() => setOpen(false)} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Close AI Assistant"><Icon name="close" /></button>
          </header>
          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--crm-surface-subtle)] p-4">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 shadow-sm ${message.role === 'user' ? 'rounded-br-md bg-[var(--crm-brand)] text-white' : 'rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-ink)]'}`}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}
            {sending ? <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3.5 py-2.5 text-sm text-[var(--crm-text-muted)]">Reading the CRM…</div></div> : null}
            {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
          </div>
          <form onSubmit={submit} className="border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
            <label htmlFor="giraffe-ai-request" className="sr-only">Ask the AI Assistant</label>
            <div className="flex items-end gap-2 rounded-xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 focus-within:border-[var(--crm-violet)]">
              <textarea id="giraffe-ai-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt(input) } }} placeholder="Ask about a lead, metric, route, or workflow…" className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-[var(--crm-ink)] outline-none placeholder:text-[var(--crm-text-dim)]" />
              <button type="submit" disabled={!input.trim() || sending} className="crm-primary-button grid h-10 w-10 shrink-0 place-items-center rounded-lg disabled:opacity-50" aria-label="Send AI request"><Icon name="arrow_upward" /></button>
            </div>
            <p className="mt-1.5 text-[9px] text-[var(--crm-text-muted)]">Read and analysis are immediate. System changes still require confirmation.</p>
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
