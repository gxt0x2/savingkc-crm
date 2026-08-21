'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'

type SmsTemplate = {
  id: string
  name: string
  category: string
  body: string
  merge_fields: string[] | null
  usage_count: number | null
}

const TEMPLATE_CATEGORIES = [
  ['prospecting_intro', 'Initial prospecting'],
  ['list_pre_auction_delinquent', 'Pre-auction delinquent'],
  ['list_excess_proceeds', 'Excess proceeds'],
  ['list_general_two_year_delinquent', 'General 2-year delinquent'],
  ['list_three_year_delinquent', '3+ year delinquent'],
  ['prospecting_reply', 'Seller reply'],
  ['prospecting_follow_up', 'Follow-up'],
  ['prospecting_wrong_number', 'Wrong number'],
  ['prospecting_opt_out', 'Opt-out'],
] as const

const DEFAULT_BODY = '{firstName}, this is {agentName} with {companyName}. I had a note tied to {propertyAddress}. Are you the right person to speak with? Reply STOP to opt out.'
const RESTRICTED_WORDS = ['guaranteed', 'free cash', 'risk-free', 'urgent', 'act now', 'limited time', 'government', 'irs']

function displayName(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function mergeFields(body: string): string[] {
  return Array.from(new Set(body.match(/\{[A-Za-z][A-Za-z0-9]*\}/g) || []))
}

function restrictedWords(body: string): string[] {
  const normalized = body.toLowerCase()
  return RESTRICTED_WORDS.filter((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+')
    return new RegExp(`(^|\\W)${escaped}(?=$|\\W)`, 'i').test(normalized)
  })
}

export function SmsTemplateManager() {
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('Initial heir outreach')
  const [category, setCategory] = useState('prospecting_intro')
  const [body, setBody] = useState(DEFAULT_BODY)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  const loadTemplates = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/api/sms-templates', { cache: 'no-store', signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'SMS templates are unavailable.')
      setTemplates(Array.isArray(payload.templates) ? payload.templates : [])
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setLoadError(cause instanceof Error ? cause.message : 'SMS templates are unavailable.')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadTemplates(controller.signal)
    return () => controller.abort()
  }, [loadTemplates])

  const visibleTemplates = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return templates
    return templates.filter((template) => [template.name, template.category, template.body]
      .some((value) => value.toLowerCase().includes(needle)))
  }, [search, templates])

  const fields = useMemo(() => mergeFields(body), [body])
  const restricted = useMemo(() => restrictedWords(body), [body])
  const hasOptOut = /\bstop\b/i.test(body)
  const canSave = name.trim().length > 0 && body.trim().length >= 8 && restricted.length === 0

  function editTemplate(template: SmsTemplate) {
    setName(template.name)
    setCategory(template.category)
    setBody(template.body)
    setSaveStatus('')
  }

  function startNewTemplate() {
    setName('')
    setCategory('prospecting_intro')
    setBody(DEFAULT_BODY)
    setSaveStatus('')
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    setSaveStatus('')
    try {
      const response = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), category, body: body.trim(), merge_fields: fields }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save the SMS template.')
      setSaveStatus('Template saved and available in Conversations.')
      await loadTemplates()
    } catch (cause) {
      setSaveStatus(cause instanceof Error ? cause.message : 'Could not save the SMS template.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-4 border-b border-[var(--crm-border)] p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="crm-eyebrow">Text messaging</p>
          <h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">SMS Template Library</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--crm-text-muted)]">Manage reusable, human-reviewed messages here. Agents insert them from the canonical Conversations composer.</p>
        </div>
        <button type="button" onClick={startNewTemplate} className="crm-secondary-button inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-black">
          <Icon name="add" className="text-[17px]" />New SMS template
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
        <div className="border-b border-[var(--crm-border)] p-5 lg:border-b-0 lg:border-r">
          <label className="relative block">
            <span className="sr-only">Search SMS templates</span>
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SMS templates…" className="crm-field h-10 w-full rounded-lg pl-10 pr-3 text-sm outline-none" />
          </label>

          {loadError ? <div role="alert" className="mt-4 rounded-xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] p-4 text-sm font-bold text-[var(--crm-danger)]">{loadError}</div> : null}
          {loading ? <p role="status" className="py-10 text-center text-sm font-bold text-[var(--crm-text-muted)]">Loading SMS templates…</p> : null}
          {!loading && visibleTemplates.length === 0 ? <p className="py-10 text-center text-sm font-bold text-[var(--crm-text-muted)]">No SMS templates match.</p> : null}

          {!loading && visibleTemplates.length > 0 ? (
            <div className="mt-4 space-y-2">
              {visibleTemplates.map((template) => (
                <button key={template.id} type="button" onClick={() => editTemplate(template)} className="w-full rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4 text-left transition hover:border-[var(--crm-info)] hover:bg-[var(--crm-info-soft)]">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-[var(--crm-ink)]">{displayName(template.name)}</strong>
                      <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-info)]">{displayName(template.category)}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-bold text-[var(--crm-text-muted)]">Used {(template.usage_count || 0).toLocaleString()}×</span>
                  </span>
                  <span className="mt-2 line-clamp-2 block text-xs leading-5 text-[var(--crm-text-muted)]">{template.body}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <form onSubmit={saveTemplate} className="space-y-4 p-5">
          <div>
            <p className="crm-eyebrow">Editor</p>
            <h3 className="mt-1 font-black text-[var(--crm-ink)]">Review before publishing</h3>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-[var(--crm-ink)]">Template name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} className="crm-field h-10 w-full rounded-lg px-3 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-[var(--crm-ink)]">Purpose</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="crm-field h-10 w-full rounded-lg px-3 text-sm">
              {TEMPLATE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              {!TEMPLATE_CATEGORIES.some(([value]) => value === category) ? <option value={category}>{displayName(category)}</option> : null}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-black text-[var(--crm-ink)]">Message</span>
            <textarea required rows={8} value={body} onChange={(event) => setBody(event.target.value)} className="crm-field w-full rounded-lg px-3 py-2 text-sm leading-6" />
          </label>

          <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4 text-xs">
            <p className="font-black text-[var(--crm-ink)]">Publishing checks</p>
            <ul className="mt-2 space-y-1.5 text-[var(--crm-text-muted)]">
              <li>{body.trim().length >= 8 ? '✓' : '○'} Clear message body</li>
              <li>{hasOptOut ? '✓' : '○'} Includes STOP opt-out language</li>
              <li>{restricted.length === 0 ? '✓' : '○'} No restricted urgency or guarantee language{restricted.length ? `: ${restricted.join(', ')}` : ''}</li>
              <li>{fields.length > 0 ? '✓' : '○'} Merge fields: {fields.length ? fields.join(', ') : 'none'}</li>
            </ul>
          </div>

          {saveStatus ? <p role="status" className={`text-xs font-bold ${saveStatus.startsWith('Template saved') ? 'text-[var(--crm-success)]' : 'text-[var(--crm-danger)]'}`}>{saveStatus}</p> : null}
          <button type="submit" disabled={!canSave || saving} className="crm-primary-button inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50">
            <Icon name="save" className="text-[18px]" />{saving ? 'Saving…' : 'Save SMS template'}
          </button>
        </form>
      </div>
    </section>
  )
}
