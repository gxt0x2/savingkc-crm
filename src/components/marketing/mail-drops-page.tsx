'use client'

import { useCallback, useEffect, useState } from 'react'
import { mailDropRates, suggestMailDropCode, type MailDropPerformance } from '@/lib/marketing/mail-drops'

type Drop = MailDropPerformance & { url: string }

const money = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(2)}%`)

async function fetchDrops(): Promise<{ drops: Drop[]; error: string | null }> {
  try {
    const response = await fetch('/api/marketing/mail-drops', { cache: 'no-store' })
    const body = await response.json() as { drops?: Drop[]; error?: string }
    return response.ok ? { drops: body.drops ?? [], error: null } : { drops: [], error: body.error ?? 'Mail drops could not be read.' }
  } catch {
    return { drops: [], error: 'Mail drops could not be read.' }
  }
}

const FIELDS: Array<{ name: string; label: string; type?: string; placeholder?: string; required?: boolean }> = [
  { name: 'name', label: 'Drop name', placeholder: 'Jackson tax-delinquent, Nov', required: true },
  { name: 'drop_date', label: 'Drop date', type: 'date', required: true },
  { name: 'pieces', label: 'Pieces mailed', type: 'number', required: true },
  { name: 'cost', label: 'Total cost ($)', type: 'number' },
  { name: 'list_name', label: 'List' },
  { name: 'county', label: 'County' },
  { name: 'piece_type', label: 'Piece type', placeholder: 'Postcard, letter, yellow letter' },
  { name: 'response_number', label: 'Response phone number', placeholder: '(816) 608-8770' },
  { name: 'landing_path', label: 'Landing page', placeholder: '/' },
  { name: 'code', label: 'Code (optional)', placeholder: 'made from the name and date' },
]

export function MailDropsPage() {
  const [drops, setDrops] = useState<Drop[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const apply = useCallback((result: { drops: Drop[]; error: string | null }) => {
    setDrops(result.drops)
    setError(result.error)
  }, [])

  useEffect(() => {
    let alive = true
    void fetchDrops().then((result) => { if (alive) apply(result) })
    return () => { alive = false }
  }, [apply])

  async function addDrop(form: HTMLFormElement) {
    setSaving(true)
    setNotice(null)
    const body = Object.fromEntries(new FormData(form).entries())
    const response = await fetch('/api/marketing/mail-drops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({})) as { error?: string; url?: string }
    setSaving(false)
    if (!response.ok) return setNotice(result.error ?? 'The drop could not be saved.')
    form.reset()
    setNotice(`Saved. Print this link or its QR code on the piece: ${result.url}`)
    apply(await fetchDrops())
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-4 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <header className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 py-4">
        <h1 className="text-xl font-black text-[var(--crm-text)]">Direct mail</h1>
        <p className="text-sm text-[var(--crm-text-muted)]">
          Each drop gets a tagged link for its QR code and, if you give one, a response number. Visits, calls, texts and leads from either are credited to the drop.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5">
        <h2 className="mb-3 text-sm font-black text-[var(--crm-text)]">Add a drop</h2>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(event) => { event.preventDefault(); void addDrop(event.currentTarget) }}
          onChange={(event) => {
            const form = event.currentTarget
            const code = form.elements.namedItem('code') as HTMLInputElement | null
            const name = (form.elements.namedItem('name') as HTMLInputElement | null)?.value ?? ''
            const date = (form.elements.namedItem('drop_date') as HTMLInputElement | null)?.value ?? ''
            if (code && name && date) code.placeholder = suggestMailDropCode(name, date)
          }}
        >
          {FIELDS.map((field) => (
            <label key={field.name} className="flex flex-col gap-1 text-xs font-semibold text-[var(--crm-text-muted)]">
              {field.label}
              <input
                name={field.name}
                type={field.type ?? 'text'}
                required={field.required}
                placeholder={field.placeholder}
                min={field.type === 'number' ? 0 : undefined}
                step={field.name === 'cost' ? '0.01' : undefined}
                className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 py-1.5 text-sm text-[var(--crm-text)]"
              />
            </label>
          ))}
          <div className="flex items-end">
            <button type="submit" disabled={saving} className="crm-primary-button rounded-xl px-4 py-2 text-sm font-black disabled:opacity-50">
              {saving ? 'Saving' : 'Add drop'}
            </button>
          </div>
        </form>
        {notice && <p className="mt-3 break-all text-sm text-[var(--crm-text)]">{notice}</p>}
      </section>

      <section className="overflow-x-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
        {error && <p className="p-4 text-sm text-[var(--crm-text)]">{error}</p>}
        {!error && !drops.length && <p className="p-4 text-sm text-[var(--crm-text-muted)]">No drops yet.</p>}
        {drops.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--crm-text-muted)]">
              <tr>
                {['Drop', 'Mailed', 'Pieces', 'Cost', 'Web visits', 'Leads', 'By phone', 'Appts', 'Contracts', 'Closes', 'Response', 'Cost / lead', 'Link'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {drops.map((drop) => {
                const rates = mailDropRates(drop)
                return (
                  <tr key={drop.id} className="border-t border-[var(--crm-border)] text-[var(--crm-text)]">
                    <td className="px-3 py-2"><div className="font-semibold">{drop.name}</div><div className="text-xs text-[var(--crm-text-muted)]">{[drop.code, drop.list_name, drop.county].filter(Boolean).join(' · ')}</div></td>
                    <td className="px-3 py-2 whitespace-nowrap">{drop.drop_date}</td>
                    <td className="px-3 py-2">{drop.pieces.toLocaleString()}</td>
                    <td className="px-3 py-2">{money(drop.cost === null ? null : Number(drop.cost))}</td>
                    <td className="px-3 py-2">{drop.web_visits}</td>
                    <td className="px-3 py-2">{drop.leads}</td>
                    <td className="px-3 py-2">{drop.phone_leads}</td>
                    <td className="px-3 py-2">{drop.appointments}</td>
                    <td className="px-3 py-2">{drop.contracts}</td>
                    <td className="px-3 py-2">{drop.closes}</td>
                    <td className="px-3 py-2">{pct(rates.responseRate)}</td>
                    <td className="px-3 py-2">{money(rates.costPerLead)}</td>
                    <td className="px-3 py-2"><button type="button" className="text-xs font-semibold underline" onClick={() => void navigator.clipboard?.writeText(drop.url)}>Copy link</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
