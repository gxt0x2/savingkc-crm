'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'
import { formatPhone } from '@/lib/format'

interface SendingNumber {
  id: string
  phone: string
  label: string | null
  type: 'local' | 'toll_free'
  status: 'active' | 'paused' | 'warming' | 'released'
  sms_sent: number
  sms_delivered: number
  sms_blocked: number
  active_chats: number
  daily_sent: number
  daily_cap: number
  last_used_at: string | null
  block_rate: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function statusColor(status: SendingNumber['status']): string {
  switch (status) {
    case 'active':
      return 'text-emerald-400'
    case 'paused':
      return 'text-[var(--ck-text-muted)]'
    case 'warming':
      return 'text-amber-400'
    case 'released':
      return 'text-[var(--ck-text-dim)]'
  }
}

export default function MessagingNumbersPage() {
  const [numbers, setNumbers] = useState<SendingNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phone, setPhone] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<'local' | 'toll_free'>('local')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/sc/numbers')
      const json = await res.json()
      if (res.ok) setNumbers(json.numbers || [])
      else setError(json.error || 'Failed to load')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function seed() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/sc/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed' }),
      })
      const json = await res.json()
      if (!res.ok) setError(json.error || 'Seed failed')
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setBusy(false)
    }
  }

  async function addNumber() {
    if (!phone.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/sc/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), label: label.trim() || null, type }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Add failed')
      } else {
        setPhone('')
        setLabel('')
        setType('local')
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError('')
    try {
      const res = await fetch('/api/sc/numbers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Update failed')
      } else if (json.number) {
        setNumbers((prev) =>
          prev.map((n) => (n.id === id ? { ...n, ...json.number, block_rate: n.block_rate } : n)),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  function toggleStatus(n: SendingNumber) {
    patch(n.id, { status: n.status === 'active' ? 'paused' : 'active' })
  }

  function editCap(n: SendingNumber) {
    const input = window.prompt(`Daily cap for ${formatPhone(n.phone)}`, String(n.daily_cap))
    if (input === null) return
    const val = Number(input)
    if (!Number.isFinite(val) || val < 0) {
      setError('Daily cap must be a non-negative number')
      return
    }
    patch(n.id, { daily_cap: Math.round(val) })
  }

  const activeCount = numbers.filter((n) => n.status === 'active').length
  const avgBlockRate = numbers.length
    ? numbers.reduce((sum, n) => sum + n.block_rate, 0) / numbers.length
    : 0

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-bold text-white">Messaging numbers</h1>
            <button
              onClick={seed}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] text-sm font-semibold px-3 py-2 text-[var(--ck-text)] hover:bg-white/5 disabled:opacity-40"
            >
              <Icon name="sync" size="text-lg" className="text-[var(--ck-text-dim)]" /> Seed from Twilio
            </button>
          </div>

          {/* Summary */}
          <div className="flex flex-wrap gap-4 mb-4 text-sm">
            <div className="text-[var(--ck-text-muted)]">
              Active numbers: <span className="font-semibold text-white">{activeCount}</span>
            </div>
            <div className="text-[var(--ck-text-muted)]">
              Avg block rate:{' '}
              <span className={`font-semibold ${avgBlockRate >= 0.1 ? 'text-[#E32E2E]' : 'text-white'}`}>
                {(avgBlockRate * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Add number form */}
          <div className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+18165551234"
                className="rounded-lg bg-[var(--ck-bg)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Optional"
                className="rounded-lg bg-[var(--ck-bg)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-[var(--ck-text-dim)] mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'local' | 'toll_free')}
                className="rounded-lg bg-[var(--ck-bg)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
              >
                <option value="local">Local</option>
                <option value="toll_free">Toll-free</option>
              </select>
            </div>
            <button
              onClick={addNumber}
              disabled={!phone.trim() || busy}
              className="flex items-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold px-3 py-2 hover:bg-[#c72828] disabled:opacity-40"
            >
              <Icon name="add" size="text-lg" /> Add number
            </button>
          </div>

          {error && <div className="mb-3 text-sm text-[#E32E2E]">{error}</div>}

          {loading ? (
            <div className="text-sm text-[var(--ck-text-dim)]">Loading…</div>
          ) : numbers.length === 0 ? (
            <div className="text-sm text-[var(--ck-text-dim)]">
              No numbers yet. Seed from Twilio or add one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--ck-text-dim)] border-b border-[var(--ck-border)]">
                    <th className="py-2 pr-4 font-semibold">Phone</th>
                    <th className="py-2 pr-4 font-semibold">Type</th>
                    <th className="py-2 pr-4 font-semibold">Status</th>
                    <th className="py-2 pr-4 font-semibold text-right">SMS sent</th>
                    <th className="py-2 pr-4 font-semibold text-right">Delivered</th>
                    <th className="py-2 pr-4 font-semibold text-right">Block rate</th>
                    <th className="py-2 pr-4 font-semibold text-right">Active chats</th>
                    <th className="py-2 pr-4 font-semibold text-right">Daily</th>
                    <th className="py-2 pr-4 font-semibold">Last used</th>
                    <th className="py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.id} className="border-b border-[var(--ck-border)]">
                      <td className="py-2 pr-4 text-[var(--ck-text)]">
                        <div className="font-semibold">{formatPhone(n.phone)}</div>
                        {n.label && <div className="text-xs text-[var(--ck-text-dim)]">{n.label}</div>}
                      </td>
                      <td className="py-2 pr-4 text-[var(--ck-text-muted)]">
                        {n.type === 'toll_free' ? 'Toll-free' : 'Local'}
                      </td>
                      <td className={`py-2 pr-4 capitalize font-semibold ${statusColor(n.status)}`}>
                        {n.status}
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--ck-text-muted)]">{n.sms_sent}</td>
                      <td className="py-2 pr-4 text-right text-[var(--ck-text-muted)]">
                        {n.sms_delivered}
                      </td>
                      <td
                        className={`py-2 pr-4 text-right font-semibold ${
                          n.block_rate >= 0.1 ? 'text-[#E32E2E]' : 'text-[var(--ck-text-muted)]'
                        }`}
                      >
                        {(n.block_rate * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--ck-text-muted)]">
                        {n.active_chats}
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--ck-text-muted)]">
                        <button
                          onClick={() => editCap(n)}
                          className="hover:text-[var(--ck-text)] hover:underline"
                          title="Edit daily cap"
                        >
                          {n.daily_sent}/{n.daily_cap}
                        </button>
                      </td>
                      <td className="py-2 pr-4 text-[var(--ck-text-dim)] whitespace-nowrap">
                        {fmtDate(n.last_used_at)}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <button
                          onClick={() => toggleStatus(n)}
                          className="inline-flex items-center gap-1 text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
                          title={n.status === 'active' ? 'Pause' : 'Activate'}
                        >
                          <Icon
                            name={n.status === 'active' ? 'pause_circle' : 'play_circle'}
                            size="text-lg"
                          />
                          {n.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
