'use client'

import { FormEvent, useEffect, useState } from 'react'
import { excessProceedsLedgerSource, type ExcessProceedsFile } from '@/types/excess-proceeds'

function money(amount: number | null) {
  if (amount === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function showDate(value: string | null) {
  return value || '—'
}

export function ExcessProceedsDealPanel({ leadId }: { leadId: string }) {
  const [file, setFile] = useState<ExcessProceedsFile | null>(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formVersion, setFormVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/prospecting/excess-proceeds/${leadId}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setHidden(true)
          return
        }
        const body = await response.json() as { file?: ExcessProceedsFile; error?: string }
        if (!response.ok) throw new Error(body.error || 'Excess-proceeds fields could not be loaded.')
        setFile(body.file ?? null)
      })
      .catch((loadError) => {
        if ((loadError as Error).name === 'AbortError') return
        setError(loadError instanceof Error ? loadError.message : 'Excess-proceeds fields could not be loaded.')
      })
    return () => controller.abort()
  }, [leadId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    const form = new FormData(event.currentTarget)
    const numberOrNull = (name: string) => {
      const raw = String(form.get(name) ?? '').trim()
      return raw ? Number(raw) : null
    }
    const textOrNull = (name: string) => {
      const raw = String(form.get(name) ?? '').trim()
      return raw || null
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/prospecting/excess-proceeds/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counsel_status: form.get('counsel_status'),
          form_pack_status: form.get('form_pack_status'),
          form_pack_url: textOrNull('form_pack_url'),
          payout_ready: form.get('payout_ready') === 'yes',
          surplus_fee_pct: Number(form.get('surplus_fee_pct')),
          score: numberOrNull('score'),
          owner_is_entity: form.get('owner_is_entity') === 'yes',
          zestimate: numberOrNull('zestimate'),
          zestimate_as_of: textOrNull('zestimate_as_of'),
          sale_date: textOrNull('sale_date'),
          excess_amount: numberOrNull('excess_amount'),
          purchase_price: numberOrNull('purchase_price'),
          judgment_amount: numberOrNull('judgment_amount'),
          confirmed_date: textOrNull('confirmed_date'),
          deed_date: textOrNull('deed_date'),
          set_aside_date: textOrNull('set_aside_date'),
          refund_date: textOrNull('refund_date'),
          excess_application_filed_date: textOrNull('excess_application_filed_date'),
          excess_denied_date: textOrNull('excess_denied_date'),
          excess_paid_date: textOrNull('excess_paid_date'),
        }),
      })
      const body = await response.json() as { file?: ExcessProceedsFile; error?: string }
      if (!response.ok || !body.file) throw new Error(body.error || 'Excess-proceeds fields could not be saved.')
      setFile(body.file)
      setFormVersion((version) => version + 1)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Excess-proceeds fields could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (hidden || (!file && !error)) return null

  return (
    <section className="rounded-2xl border border-[var(--crm-brand-border)] bg-[var(--crm-surface)] p-4" aria-label="Excess Proceeds (Ch 141)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black text-[var(--crm-ink)]">Excess Proceeds (Ch 141)</h2>
        <span className="rounded-full bg-[var(--crm-brand-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Jackson DLT</span>
        {file?.claim_period_elapsed ? <span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-text-muted)]">Claim period elapsed</span> : null}
        {file?.payout_ready ? <span className="rounded-full bg-[var(--crm-brand-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Payout ready</span> : null}
        {file?.excess_application_filed_date ? <span className="rounded-full border border-[var(--crm-brand-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Application filed</span> : null}
        {file?.handoff_ready ? <span className="rounded-full bg-[var(--crm-brand)] px-2 py-0.5 text-[10px] font-bold text-[var(--crm-on-brand)]">Handoff ready</span> : null}
      </div>
      {error ? <p role="alert" className="mb-3 text-sm font-semibold text-[var(--crm-ink)]">{error}</p> : null}
      {file ? (
        <form key={formVersion} className="grid gap-3 md:grid-cols-3" onSubmit={save}>
          <Fact label="Suit no" value={file.suit_no} />
          <Fact label="Parcel no" value={file.parcel_no} />
          <Fact label="Claim deadline" value={showDate(file.claim_deadline)} detail={file.days_to_claim_deadline === null ? 'Set the sale date to start the two-year clock.' : `${file.days_to_claim_deadline} days from today`} />
          <Field label="Date sold" name="sale_date" type="date" defaultValue={file.sale_date ?? ''} />
          <Field label="Purchase price" name="purchase_price" type="number" step="0.01" defaultValue={file.purchase_price ?? ''} />
          <Field label="Judgment" name="judgment_amount" type="number" step="0.01" defaultValue={file.judgment_amount ?? ''} />
          <Field label="Excess" name="excess_amount" type="number" step="0.01" defaultValue={file.excess_amount ?? ''} />
          <Field label="Confirmed" name="confirmed_date" type="date" defaultValue={file.confirmed_date ?? ''} />
          <Field label="Deed" name="deed_date" type="date" defaultValue={file.deed_date ?? ''} />
          <Field label="Set aside" name="set_aside_date" type="date" defaultValue={file.set_aside_date ?? ''} />
          <Field label="Refund" name="refund_date" type="date" defaultValue={file.refund_date ?? ''} />
          <Field label="Excess app filed" name="excess_application_filed_date" type="date" defaultValue={file.excess_application_filed_date ?? ''} />
          <Field label="Excess denied" name="excess_denied_date" type="date" defaultValue={file.excess_denied_date ?? ''} />
          <Field label="Excess paid" name="excess_paid_date" type="date" defaultValue={file.excess_paid_date ?? ''} />
          <Select label="Counsel" name="counsel_status" defaultValue={file.counsel_status} options={[['pending', 'Pending'], ['clear', 'Clear'], ['blocked', 'Blocked']]} />
          <Select label="Form pack" name="form_pack_status" defaultValue={file.form_pack_status} options={[['none', 'None'], ['drafted', 'Drafted'], ['signed', 'Signed']]} />
          <Select label="Payout ready" name="payout_ready" defaultValue={file.payout_ready ? 'yes' : 'no'} options={[['no', 'No'], ['yes', 'Yes']]} />
          <Select label="Owner is entity" name="owner_is_entity" defaultValue={file.owner_is_entity ? 'yes' : 'no'} options={[['no', 'No'], ['yes', 'Yes']]} />
          <Field label="Surplus fee %" name="surplus_fee_pct" type="number" step="0.01" defaultValue={file.surplus_fee_pct} />
          <Field label="Score" name="score" type="number" step="0.01" defaultValue={file.score ?? ''} />
          <Field label="Zestimate" name="zestimate" type="number" step="0.01" defaultValue={file.zestimate ?? ''} />
          <Field label="Zestimate as of" name="zestimate_as_of" type="date" defaultValue={file.zestimate_as_of ?? ''} />
          <label className="text-xs font-bold text-[var(--crm-ink)] md:col-span-2">Drive form pack
            <input name="form_pack_url" type="url" defaultValue={file.form_pack_url ?? ''} placeholder="Paste the Drive form-pack link" className="mt-1 block h-9 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 text-sm font-semibold text-[var(--crm-ink)]" />
          </label>
          <div className="text-xs text-[var(--crm-text-muted)]">
            {file.form_pack_url ? <a href={file.form_pack_url} className="font-bold text-[var(--crm-brand)]" target="_blank" rel="noreferrer">Open Drive form pack</a> : <p>Drive form pack not linked yet.</p>}
            <p className="mt-2">Zestimate stays blank until a value and an as-of date are both entered. Nothing here is estimated for you.</p>
            <p className="mt-2">Treasury posts fee income as “Excess proceeds fee income” on the Deal File ledger. Suggested source: {excessProceedsLedgerSource(file.suit_no, file.parcel_no, 'fee')}. Gross surplus uses {excessProceedsLedgerSource(file.suit_no, file.parcel_no, 'recovery')}.</p>
            <p className="mt-2">Current excess {money(file.excess_amount)}. Fee default is {file.surplus_fee_pct}%.</p>
          </div>
          <div className="md:col-span-3">
            <button type="submit" disabled={saving} className="rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-xs font-black text-[var(--crm-on-brand)] disabled:opacity-60">
              {saving ? 'Saving…' : 'Save excess-proceeds fields'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">{label}</p>
      <p className="text-sm font-bold text-[var(--crm-ink)]">{value}</p>
      {detail ? <p className="text-xs text-[var(--crm-text-muted)]">{detail}</p> : null}
    </div>
  )
}

function Field({ label, name, type, defaultValue, step }: { label: string; name: string; type: string; defaultValue: string | number; step?: string }) {
  return (
    <label className="text-xs font-bold text-[var(--crm-ink)]">{label}
      <input name={name} type={type} step={step} defaultValue={defaultValue} className="mt-1 block h-9 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 text-sm font-semibold text-[var(--crm-ink)]" />
    </label>
  )
}

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: [string, string][] }) {
  return (
    <label className="text-xs font-bold text-[var(--crm-ink)]">{label}
      <select name={name} defaultValue={defaultValue} className="mt-1 block h-9 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2 text-sm font-semibold text-[var(--crm-ink)]">
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  )
}
