'use client'

import { useCallback, useEffect, useState } from 'react'
import { NUMBER_CHANNELS, NUMBER_CHANNEL_LABELS } from '@/lib/attribution/number-channels'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'

type Row = { number: string; channel: string; campaign: string | null }

/** Lines the code already labels (Google Ads, cold-call callbacks) are shown read-only. */
const CODE_LABELED: Record<string, string> = { google_ads: 'Google Ads (set in code)', cold_call: 'Cold-call callbacks (set in code)' }

type LoadResult = { status: 'ready'; rows: Row[] } | { status: 'forbidden' | 'error'; rows: [] }

async function fetchRows(): Promise<LoadResult> {
  try {
    const response = await fetch('/api/admin/tracking-number-channels', { cache: 'no-store' })
    if (response.status === 401 || response.status === 403) return { status: 'forbidden', rows: [] }
    if (!response.ok) return { status: 'error', rows: [] }
    const data = (await response.json()) as { rows: Row[] }
    return { status: 'ready', rows: data.rows }
  } catch {
    return { status: 'error', rows: [] }
  }
}

export function NumberChannels() {
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
  const [saving, setSaving] = useState<string | null>(null)

  const apply = useCallback((result: LoadResult) => {
    if (result.status === 'ready') setRows(Object.fromEntries(result.rows.map((row) => [row.number, row])))
    setStatus(result.status)
  }, [])

  useEffect(() => {
    let alive = true
    void fetchRows().then((result) => { if (alive) apply(result) })
    return () => { alive = false }
  }, [apply])

  async function save(number: string, channel: string, campaign: string) {
    setSaving(number)
    const response = await fetch('/api/admin/tracking-number-channels', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, channel: channel || null, campaign }),
    })
    setSaving(null)
    if (response.ok) apply(await fetchRows())
    else setStatus('error')
  }

  if (status === 'forbidden') return null

  return (
    <div className="ck-card p-5">
      <h2 className="text-lg font-bold text-[var(--ck-text)] mb-1">Phone number channels</h2>
      <p className="text-[13px] text-[var(--ck-text-muted)] mb-4">
        Calls and texts to each number are credited to this channel. Use it for mail, sign and referral numbers.
      </p>
      {status === 'error' && <p className="text-[13px] text-red-600 mb-3">Could not load or save. Try again.</p>}
      <div className="space-y-2">
        {TWILIO_NUMBERS.map((line) => {
          const fixed = CODE_LABELED[line.purpose]
          const row = rows[line.value]
          return (
            <div key={line.value} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="w-56 shrink-0 text-[var(--ck-text)]">{line.label}</span>
              {fixed ? (
                <span className="text-[var(--ck-text-muted)]">{fixed}</span>
              ) : (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    void save(line.value, String(form.get('channel') || ''), String(form.get('campaign') || ''))
                  }}
                >
                  <select name="channel" defaultValue={row?.channel ?? ''} className="border rounded-lg px-2 py-1 bg-white">
                    <option value="">Not set</option>
                    {NUMBER_CHANNELS.map((channel) => <option key={channel} value={channel}>{NUMBER_CHANNEL_LABELS[channel]}</option>)}
                  </select>
                  <input name="campaign" defaultValue={row?.campaign ?? ''} placeholder="Campaign (optional)" maxLength={120} className="border rounded-lg px-2 py-1 flex-1 min-w-32" />
                  <button type="submit" disabled={saving === line.value} className="text-sm font-semibold px-3 py-1 rounded-lg border disabled:opacity-50">
                    {saving === line.value ? 'Saving' : 'Save'}
                  </button>
                </form>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
