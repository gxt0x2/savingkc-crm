'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { AssistantSources } from '@/components/ai/assistant-sources'
import { Icon } from '@/components/ui/icon'
import { useAssistantThread } from '@/hooks/use-assistant-thread'

type LiveSnapshot = { leads: number | null; needsReply: number | null; phones: number | null; workflows: number | null }

const STARTERS = [
  'What needs my attention right now?',
  'Audit every phone route and show me the mismatches.',
  'Which workflows can send communication?',
  'Draft a workflow for an appointment that becomes a no-show.',
  'Explain our transaction closeout and debrief path.',
  'Show the work assigned to Ernest versus Casey.',
]

export default function AiAssistantPage() {
  const params = useSearchParams()
  const initialPrompt = params.get('prompt')?.trim() || ''
  const { messages, loadingHistory, sending, error, send, clear } = useAssistantThread('ai_page')
  const [input, setInput] = useState(initialPrompt)
  const [snapshot, setSnapshot] = useState<LiveSnapshot>({ leads: null, needsReply: null, phones: null, workflows: null })
  const autoSent = useRef(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/reports/operating?period=30d', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null),
      fetch('/api/workflows/summary', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null),
    ]).then(([report, registry]) => {
      setSnapshot({
        leads: typeof report?.core?.leads === 'number' ? report.core.leads : null,
        needsReply: typeof report?.core?.needsReply === 'number' ? report.core.needsReply : null,
        phones: typeof registry?.phones === 'number' ? registry.phones : null,
        workflows: typeof registry?.workflows === 'number' ? registry.workflows : null,
      })
    }).catch(() => {})
  }, [])

  async function sendPrompt(prompt: string) {
    const clean = prompt.trim()
    if (!clean || sending || loadingHistory) return
    setInput('')
    const sent = await send(clean)
    if (!sent) setInput(clean)
  }

  useEffect(() => {
    if (!initialPrompt || loadingHistory || autoSent.current) return
    autoSent.current = true
    void sendPrompt(initialPrompt)
    // The initial URL prompt is intentionally submitted only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, loadingHistory])

  function submit(event: FormEvent) {
    event.preventDefault()
    void sendPrompt(input)
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto w-full max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4 border-b border-[var(--crm-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="crm-eyebrow">SavingKC operating intelligence</p><h1 className="mt-1 text-3xl font-black tracking-tight">AI Assistant</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--crm-text-muted)]">One place to ask about the CRM, investigate operating state, trace system behavior, and draft controlled changes.</p></div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] px-3 py-2 text-xs font-black text-[var(--crm-success)]"><span className="h-2 w-2 rounded-full bg-[var(--crm-success)]" />Live CRM context</div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="crm-panel flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="smart_toy" className="text-[22px]" /></div><div><h2 className="font-black">Ask ARI anything</h2><p className="text-xs text-[var(--crm-text-muted)]">Persistent history · actor-scoped CRM evidence</p></div></div><button type="button" onClick={() => void clear()} disabled={sending || loadingHistory} className="crm-secondary-button h-9 rounded-lg px-3 text-xs font-black disabled:opacity-50">New conversation</button></div>
            <div className="flex-1 space-y-4 overflow-y-auto bg-[var(--crm-surface-subtle)]/50 p-5">
              {loadingHistory ? <div className="text-sm text-[var(--crm-text-muted)]">Loading your conversation…</div> : null}
              {!loadingHistory && messages.length === 0 ? <div className="flex justify-start"><div className="max-w-[82%] rounded-2xl rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3 text-sm leading-6 text-[var(--crm-ink)] shadow-sm">Ask me to inspect the CRM, explain a phone or workflow path, analyze performance, find a contact, or draft an operating change. I use live read-only context; consequential changes require confirmation.</div></div> : null}
              {messages.map((message) => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === 'user' ? 'rounded-br-md bg-[var(--crm-brand)] text-white' : 'rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-ink)]'}`}><p className="whitespace-pre-wrap">{message.content}</p>{message.role === 'assistant' ? <AssistantSources sources={message.sources} /> : null}</div></div>)}
              {sending ? <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3 text-sm text-[var(--crm-text-muted)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--crm-violet)]" /><span>Reading the CRM and system registry…</span></div></div> : null}
              {error ? <div className="rounded-xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}
            </div>
            <form onSubmit={submit} className="border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-4"><label htmlFor="ai-request" className="sr-only">Ask ARI</label><div className="flex items-end gap-3 rounded-2xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 focus-within:border-[var(--crm-violet)] focus-within:ring-2 focus-within:ring-[var(--crm-violet-soft)]"><textarea id="ai-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt(input) } }} placeholder="Ask about a lead, metric, phone route, workflow, or operating change…" className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--crm-text-dim)]" /><button type="submit" disabled={!input.trim() || sending || loadingHistory} className="crm-primary-button grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send request"><Icon name="arrow_upward" /></button></div><div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-[var(--crm-text-muted)]"><span>Enter to send · Shift+Enter for a new line</span><span>Changes require confirmation</span></div></form>
          </div>

          <aside className="space-y-4">
            <section className="crm-panel rounded-2xl p-4"><div className="flex items-center gap-2"><Icon name="database" className="text-[var(--crm-info)]" /><h2 className="font-black">Live context</h2></div><div className="mt-4 grid grid-cols-2 gap-2">{[['Active leads', snapshot.leads], ['Needs reply', snapshot.needsReply], ['Phone records', snapshot.phones], ['Workflow definitions', snapshot.workflows]].map(([label, value]) => <div key={label as string} className="rounded-xl bg-[var(--crm-surface-subtle)] p-3"><p className="text-xl font-black">{value == null ? 'Unavailable' : value}</p><p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}</div></section>
            <section className="crm-panel rounded-2xl p-4"><div className="flex items-center gap-2"><Icon name="security" className="text-[var(--crm-success)]" /><h2 className="font-black">Execution boundary</h2></div><p className="mt-2 text-xs leading-5 text-[var(--crm-text-muted)]">ARI can read and analyze immediately. Calls, texts, assignments, stage changes, workflow publishing, routing changes, deletes, and spending require explicit confirmation and an audit record.</p></section>
            <section className="crm-panel rounded-2xl p-4"><h2 className="font-black">Try a request</h2><div className="mt-3 space-y-2">{STARTERS.map((starter) => <button key={starter} type="button" onClick={() => void sendPrompt(starter)} disabled={sending} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--crm-border)] px-3 py-2.5 text-left text-xs font-bold text-[var(--crm-ink)] transition hover:border-[var(--crm-violet)] hover:bg-[var(--crm-violet-soft)] disabled:opacity-50"><span>{starter}</span><Icon name="arrow_forward" className="shrink-0 text-[15px] text-[var(--crm-violet)]" /></button>)}</div></section>
            <section className="crm-panel rounded-2xl p-4"><h2 className="font-black">System maps</h2><div className="mt-3 grid gap-2"><Link href="/workflows?section=phones" className="crm-secondary-button flex h-10 items-center justify-between rounded-lg px-3 text-xs font-black"><span className="flex items-center gap-2"><Icon name="phone_in_talk" />Phone System</span><Icon name="arrow_forward" /></Link><Link href="/workflows?section=all" className="crm-secondary-button flex h-10 items-center justify-between rounded-lg px-3 text-xs font-black"><span className="flex items-center gap-2"><Icon name="account_tree" />All Workflows</span><Icon name="arrow_forward" /></Link></div></section>
          </aside>
        </section>
      </div>
    </main>
  )
}
