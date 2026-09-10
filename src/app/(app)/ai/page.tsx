'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { AssistantMark } from '@/components/ai/assistant-mark'
import { AssistantMessage } from '@/components/ai/assistant-message'
import { Icon } from '@/components/ui/icon'
import { useAssistantThread } from '@/hooks/use-assistant-thread'

type LiveSnapshotValue = number | null | undefined
type LiveSnapshot = { leads: LiveSnapshotValue; needsReply: LiveSnapshotValue; phones: LiveSnapshotValue; workflows: LiveSnapshotValue }

const INITIAL_SNAPSHOT: LiveSnapshot = {
  leads: undefined,
  needsReply: undefined,
  phones: undefined,
  workflows: undefined,
}

function snapshotLabel(value: LiveSnapshotValue) {
  if (value === undefined) return 'Loading…'
  return value === null ? 'Unavailable' : value.toLocaleString()
}

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
  const { messages, loadingHistory, sending, error, send, clear, ownerEmail } = useAssistantThread('ai_page')
  const [input, setInput] = useState(initialPrompt)
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(INITIAL_SNAPSHOT)
  const autoSent = useRef(false)

  useEffect(() => {
    let active = true
    const update = (values: Partial<LiveSnapshot>) => {
      if (active) setSnapshot((current) => ({ ...current, ...values }))
    }

    void fetch('/api/contacts?mode=page&limit=1&list=all', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((directory) => update({ leads: typeof directory?.scopeCounts?.active === 'number' ? directory.scopeCounts.active : null }))
      .catch(() => update({ leads: null }))

    void fetch('/api/conversations/attention', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((attention) => update({ needsReply: typeof attention?.needsReply === 'number' ? attention.needsReply : null }))
      .catch(() => update({ needsReply: null }))

    void fetch('/api/workflows/summary', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((registry) => update({
        phones: typeof registry?.phones === 'number' ? registry.phones : null,
        workflows: typeof registry?.workflows === 'number' ? registry.workflows : null,
      }))
      .catch(() => update({ phones: null, workflows: null }))

    return () => { active = false }
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
      <div className="mx-auto w-full max-w-[1520px] space-y-5 px-3 py-4 sm:px-6 sm:py-6">
        <header className="overflow-hidden rounded-[22px] bg-[#171916] text-white shadow-[0_18px_55px_rgba(18,21,18,.15)]">
          <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-6">
            <div className="flex min-w-0 items-center gap-4">
              <AssistantMark live className="h-12 w-12 rounded-2xl ring-1 ring-white/15" />
              <div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-[.18em] text-white/55">SavingKC operating intelligence</p><h1 className="mt-1 text-2xl font-black tracking-[-.03em] sm:text-3xl">Decision room</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-white/65 sm:text-sm">Ask for a decision, not a data dump. The answer starts with what matters and keeps evidence within reach.</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start rounded-full border border-white/10 bg-white/[.06] px-3 py-2 text-[10px] font-black uppercase tracking-[.12em] text-white/75"><span className="h-2 w-2 rounded-full bg-[#65bd73] shadow-[0_0_0_4px_rgba(101,189,115,.12)]" />CRM connected</div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/10 sm:grid-cols-4">
            {([['Active leads', snapshot.leads], ['Needs reply', snapshot.needsReply], ['Phone records', snapshot.phones], ['Workflows', snapshot.workflows]] as const).map(([label, value]) => <div key={label} className="border-white/10 px-5 py-3.5 [&:not(:last-child)]:border-r"><p className="text-lg font-black tracking-tight">{snapshotLabel(value)}</p><p className="mt-0.5 text-[8px] font-black uppercase tracking-[.13em] text-white/45">{label}</p></div>)}
          </div>
        </header>

        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          <div className="crm-panel flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-[22px]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-4 py-3.5 sm:px-6"><div className="min-w-0"><h2 className="text-sm font-black tracking-tight">Your private conversation</h2><p className="mt-0.5 truncate text-[10px] font-semibold text-[var(--crm-text-muted)]"><span className="text-[var(--crm-success)]">Private</span>{ownerEmail ? ` to ${ownerEmail}` : ' to your signed-in account'} · teammates cannot open this history</p></div><button type="button" onClick={() => void clear()} disabled={sending || loadingHistory} className="crm-secondary-button h-9 shrink-0 rounded-lg px-3 text-xs font-black disabled:opacity-50">Start fresh</button></div>
            <div className="min-w-0 flex-1 space-y-6 overflow-y-auto bg-[var(--crm-canvas)] px-4 py-5 sm:px-6 sm:py-7">
              {loadingHistory ? <div className="flex items-center gap-2 text-xs font-semibold text-[var(--crm-text-muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--crm-brand)]" />Loading this conversation…</div> : null}
              {!loadingHistory && messages.length === 0 ? (
                <section className="mx-auto max-w-2xl py-10 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--crm-brand)]">A better starting point</p>
                  <h2 className="mt-3 text-2xl font-black tracking-[-.03em] sm:text-3xl">What decision are we making?</h2>
                  <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--crm-text-muted)]">Ask naturally. You will get a direct answer, the recommended next move, and expandable support—not a wall of system output.</p>
                  <div className="mt-7 grid gap-2 text-left sm:grid-cols-2">{STARTERS.slice(0, 4).map((starter) => <button key={starter} type="button" onClick={() => void sendPrompt(starter)} disabled={sending} className="group flex min-w-0 items-start justify-between gap-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3.5 text-xs font-bold leading-5 text-[var(--crm-ink)] shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--crm-brand)] hover:shadow-md disabled:opacity-50"><span>{starter}</span><Icon name="north_east" className="mt-0.5 shrink-0 text-[15px] text-[var(--crm-brand)]" /></button>)}</div>
                </section>
              ) : null}
              {messages.map((message) => message.role === 'user' ? (
                <div key={message.id} className="flex min-w-0 justify-end pl-8 sm:pl-20"><div className="min-w-0 max-w-[86%] rounded-2xl rounded-br-md bg-[#292d2a] px-4 py-3 text-sm leading-6 text-white shadow-sm ring-1 ring-white/10"><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p></div></div>
              ) : (
                <article key={message.id} className="min-w-0 max-w-4xl rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-[0_10px_30px_rgba(18,21,18,.05)]">
                  <header className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] px-4 py-3 sm:px-5"><div className="flex items-center gap-2.5"><AssistantMark className="h-7 w-7 rounded-[9px]" /><div><p className="text-[9px] font-black uppercase tracking-[.14em] text-[var(--crm-text-muted)]">Intelligence brief</p><p className="text-[10px] font-semibold text-[var(--crm-success)]">Grounded in live CRM context</p></div></div></header>
                  <div className="min-w-0 max-w-full px-4 py-4 sm:px-5 sm:py-5"><AssistantMessage content={message.content} sources={message.sources} /></div>
                </article>
              ))}
              {sending ? <div className="flex max-w-4xl items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3 text-xs font-semibold text-[var(--crm-text-muted)]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--crm-brand)]" /><span>Reading the live CRM and deciding what matters…</span></div> : null}
              {error ? <div className="rounded-xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}
            </div>
            <form onSubmit={submit} className="border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 sm:p-4"><label htmlFor="ai-request" className="sr-only">Ask SavingKC Intelligence</label><div className="flex items-end gap-3 rounded-2xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 shadow-[0_8px_24px_rgba(18,21,18,.06)] focus-within:border-[var(--crm-brand)] focus-within:ring-2 focus-within:ring-[var(--crm-brand-soft)]"><textarea id="ai-request" rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendPrompt(input) } }} placeholder="Ask the next important question…" className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-[var(--crm-text-dim)] sm:text-sm" /><button type="submit" disabled={!input.trim() || sending || loadingHistory} className="crm-primary-button grid h-11 w-11 shrink-0 place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send request"><Icon name="arrow_upward" /></button></div><div className="mt-2 flex items-center justify-between gap-3 px-1 text-[9px] text-[var(--crm-text-muted)]"><span>Enter to send · Shift+Enter for a new line</span><span>Consequential changes wait for confirmation</span></div></form>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <section className="crm-panel rounded-2xl p-4"><p className="text-[9px] font-black uppercase tracking-[.14em] text-[var(--crm-brand)]">How this thinks</p><div className="mt-3 space-y-3">{[['01', 'Answer first', 'The recommendation appears before the background.'], ['02', 'Show the move', 'Every useful answer ends in a practical next step.'], ['03', 'Prove on demand', 'Supporting detail and evidence stay expandable.']].map(([number, title, detail]) => <div key={number} className="flex gap-3"><span className="text-[9px] font-black text-[var(--crm-text-dim)]">{number}</span><div><p className="text-xs font-black">{title}</p><p className="mt-0.5 text-[10px] leading-4 text-[var(--crm-text-muted)]">{detail}</p></div></div>)}</div></section>
            <section className="crm-panel rounded-2xl p-4"><div className="flex items-center gap-2"><Icon name="shield_lock" className="text-lg text-[var(--crm-success)]" /><h2 className="text-sm font-black">You stay in control</h2></div><p className="mt-2 text-[10px] leading-5 text-[var(--crm-text-muted)]">Analysis is immediate. Calls, texts, assignments, stage changes, publishing, routing, deletion, and spend always wait for explicit confirmation.</p></section>
            {messages.length > 0 ? <section className="crm-panel rounded-2xl p-4"><p className="text-[9px] font-black uppercase tracking-[.14em] text-[var(--crm-text-muted)]">Ask next</p><div className="mt-3 space-y-2">{STARTERS.slice(4).map((starter) => <button key={starter} type="button" onClick={() => void sendPrompt(starter)} disabled={sending} className="flex w-full items-start justify-between gap-2 rounded-xl border border-[var(--crm-border)] px-3 py-2.5 text-left text-[10px] font-bold leading-4 transition hover:border-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)] disabled:opacity-50"><span>{starter}</span><Icon name="north_east" className="shrink-0 text-sm text-[var(--crm-brand)]" /></button>)}</div></section> : null}
            <section className="crm-panel rounded-2xl p-4"><p className="text-[9px] font-black uppercase tracking-[.14em] text-[var(--crm-text-muted)]">System maps</p><div className="mt-3 grid gap-2"><Link href="/workflows?section=phones" className="crm-secondary-button flex h-10 items-center justify-between rounded-lg px-3 text-xs font-black"><span className="flex items-center gap-2"><Icon name="phone_in_talk" />Phone system</span><Icon name="arrow_forward" /></Link><Link href="/workflows?section=all" className="crm-secondary-button flex h-10 items-center justify-between rounded-lg px-3 text-xs font-black"><span className="flex items-center gap-2"><Icon name="account_tree" />All workflows</span><Icon name="arrow_forward" /></Link></div></section>
          </aside>
        </section>
      </div>
    </main>
  )
}
