'use client'

import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { messageTemplateName, renderMessageTemplate, type MessageTemplate, type MessageTemplateContext } from '@/lib/conversations/message-template'

const FIELD_LABELS: Record<string, string> = { fullName: 'seller name', propertyAddress: 'property address', agentName: 'agent identity' }

export function MessageTemplatePicker({ templates, loading, error, context, onSelect, onClose }: {
  templates: MessageTemplate[]
  loading: boolean
  error: string | null
  context: MessageTemplateContext
  onSelect: (message: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return templates.filter((template) => !normalized || `${template.name} ${template.category} ${template.body}`.toLowerCase().includes(normalized))
  }, [query, templates])

  return <section className="crm-menu absolute bottom-full left-0 z-50 mb-2 flex max-h-[22rem] w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl" aria-label="Message templates">
    <header className="flex items-center justify-between border-b border-[var(--crm-border)] px-3 py-2.5">
      <div><p className="text-xs font-black text-[var(--crm-ink)]">Quick replies</p><p className="text-[10px] text-[var(--crm-text-muted)]">Previewed with this seller&apos;s CRM fields</p></div>
      <button type="button" onClick={onClose} aria-label="Close message templates" className="crm-icon-button grid h-8 w-8 place-items-center rounded-lg"><Icon name="close" /></button>
    </header>
    <label className="relative border-b border-[var(--crm-border)] p-2"><Icon name="search" className="pointer-events-none absolute left-5 top-4 text-base text-[var(--crm-text-dim)]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search message templates" placeholder="Search quick replies" className="crm-field h-9 w-full rounded-lg pl-9 pr-3 text-xs" /></label>
    <div className="overflow-y-auto p-2">
      {loading ? <p role="status" className="p-4 text-center text-xs font-bold text-[var(--crm-text-muted)]">Loading quick replies…</p> : error ? <p role="alert" className="rounded-lg bg-[var(--crm-danger-soft)] p-3 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : matches.length === 0 ? <p className="p-4 text-center text-xs font-bold text-[var(--crm-text-muted)]">No quick replies match.</p> : matches.map((template) => {
        const preview = renderMessageTemplate(template.body, context)
        const unavailable = [...preview.missing.map((field) => FIELD_LABELS[field] || field), ...preview.unsupported]
        return <button key={template.id} type="button" disabled={!preview.ready} onClick={() => onSelect(preview.rendered)} className="mb-1 w-full rounded-lg border border-transparent p-3 text-left hover:border-[var(--crm-brand-border)] hover:bg-[var(--crm-brand-soft)] disabled:cursor-not-allowed disabled:opacity-55">
          <span className="flex items-center justify-between gap-2"><span className="text-xs font-black text-[var(--crm-ink)]">{messageTemplateName(template.name)}</span><span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--crm-text-muted)]">{messageTemplateName(template.category)}</span></span>
          <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-[var(--crm-text-muted)]">{preview.rendered}</span>
          {!preview.ready ? <span className="mt-1.5 block text-[10px] font-bold text-[var(--crm-warning)]">Needs {unavailable.join(', ')}</span> : null}
        </button>
      })}
    </div>
    <footer className="border-t border-[var(--crm-border)] px-3 py-2 text-[10px] font-semibold text-[var(--crm-text-muted)]">Choosing a reply only fills the composer. Review it, then send yourself.</footer>
  </section>
}
