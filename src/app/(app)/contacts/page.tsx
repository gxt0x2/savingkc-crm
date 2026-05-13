'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'
import type { DealStage } from '@/types/pipeline'

interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  address: string | null
  city: string | null
  station: DealStage
  score: number
  nextActivity: {
    when: string | null
    label: string
    kind: 'appointment' | 'recommended' | null
  } | null
  tags: string[]
  lastContactAt: string | null
  updatedAt: string | null
}

interface ContactsResponse {
  items: ContactRow[]
}

type TabKey = 'all' | 'hot' | 'new' | 'contacted' | 'qualified' | 'appointment_set' | 'offer_made' | 'in_closing'

const TABS: { key: TabKey; label: string; station?: DealStage; minScore?: number }[] = [
  { key: 'hot', label: 'Hot', minScore: 75 },
  { key: 'new', label: 'New', station: 'new' },
  { key: 'contacted', label: 'Contacted', station: 'contacted' },
  { key: 'qualified', label: 'Qualified', station: 'qualified' },
  { key: 'appointment_set', label: 'Appointment Set', station: 'appointment_set' },
  { key: 'offer_made', label: 'Offer Made', station: 'offer_made' },
  { key: 'in_closing', label: 'In Closing', station: 'under_contract' },
  { key: 'all', label: 'All' },
]

const STATION_COLORS: Record<DealStage, string> = {
  under_contract: '#E32E2E',
  offer_made: '#E32E2E',
  appointment_set: '#f59e0b',
  qualified: '#10b981',
  contacted: '#a3a3a3',
  new: '#6b7280',
  closed_won: '#10b981',
  closed_lost: '#6b7280',
  dead: '#6b7280',
}

// Tag color categories. No blue/cyan/indigo per design system.
const TAG_URGENT = /^(foreclosure|tax[_-]delinquent|3yr[_-]tax[_-]delinquent|lien|deadline|contract|under[_-]contract|contingency|urgent|hot[_-]lead)$/i
const TAG_LIFE = /^(probate|divorce|inherited|inheritance|deceased|relocation|health|financial[_-]distress|downsizing|estate)$/i
const TAG_OPPORTUNITY = /^(motivated|ready[_-]to[_-]sell|vacant|distressed|fixer|tired[_-]landlord|high[_-]motivation|opportunity|warm[_-]lead)$/i

function tagClasses(tag: string): string {
  const t = tag.replace(/\s+/g, '_')
  if (TAG_URGENT.test(t)) return 'bg-[#E32E2E]/15 text-[#E32E2E] border border-[#E32E2E]/30'
  if (TAG_LIFE.test(t)) return 'bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30'
  if (TAG_OPPORTUNITY.test(t)) return 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30'
  return 'bg-[var(--ck-bg)] text-[var(--ck-text-muted)] border border-[var(--ck-border)]'
}

function useContacts() {
  return useQuery<ContactsResponse>({
    queryKey: ['contacts'],
    queryFn: async () => {
      const res = await fetch('/api/contacts')
      if (!res.ok) throw new Error('Failed to fetch contacts')
      return res.json()
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

function formatNextActivity(activity: ContactRow['nextActivity']): string {
  if (!activity) return '--'
  if (activity.when) {
    const d = new Date(activity.when)
    if (!isNaN(d.getTime())) {
      const now = Date.now()
      const diffMs = d.getTime() - now
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      const rel = diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : diffDays > 0 ? `in ${diffDays}d` : `${-diffDays}d ago`
      return `${activity.label} · ${dateStr} ${timeStr} (${rel})`
    }
  }
  return activity.label
}

function formatPhone(phone: string | null): string {
  if (!phone) return '--'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default function ContactsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('hot')
  const { data, isLoading, error } = useContacts()

  const items = useMemo(() => data?.items ?? [], [data])

  // under_contract leads are exclusive to the In Closing tab. Every other
  // list (including All and Hot) excludes them so a closing deal can't
  // double-appear in the active acquisition queue.
  const acquisitionOnly = useMemo(() => items.filter((i) => i.station !== 'under_contract'), [items])

  const counts = useMemo<Record<TabKey, number>>(() => {
    return {
      all: acquisitionOnly.length,
      hot: acquisitionOnly.filter((i) => i.score >= 75).length,
      new: acquisitionOnly.filter((i) => i.station === 'new').length,
      contacted: acquisitionOnly.filter((i) => i.station === 'contacted').length,
      qualified: acquisitionOnly.filter((i) => i.station === 'qualified').length,
      appointment_set: acquisitionOnly.filter((i) => i.station === 'appointment_set').length,
      offer_made: acquisitionOnly.filter((i) => i.station === 'offer_made').length,
      in_closing: items.filter((i) => i.station === 'under_contract').length,
    }
  }, [items, acquisitionOnly])

  const visible = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab)
    if (!tab) return acquisitionOnly
    const pool = activeTab === 'in_closing' ? items : acquisitionOnly
    let filtered = pool
    if (tab.station) filtered = filtered.filter((i) => i.station === tab.station)
    if (tab.minScore !== undefined) filtered = filtered.filter((i) => i.score >= tab.minScore!)
    return [...filtered].sort((a, b) => b.score - a.score)
  }, [items, acquisitionOnly, activeTab])

  return (
    <div className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-text)]">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-4 flex items-center gap-3">
          <Icon name="contacts" size="text-3xl" className="text-[#E32E2E]" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
            <p className="text-sm text-[var(--ck-text-muted)]">
              Active acquisition pipeline, sorted by composite score.
            </p>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--ck-border)]">
          {TABS.map((tab) => {
            const active = activeTab === tab.key
            const count = counts[tab.key]
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  active
                    ? 'border-[#E32E2E] text-[var(--ck-text)]'
                    : 'border-transparent text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-xs ${active ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {isLoading && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center text-sm text-[var(--ck-text-muted)]">
            Loading contacts...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-4 text-sm text-[#E32E2E]">
            Failed to load: {error instanceof Error ? error.message : 'unknown error'}
          </div>
        )}

        {!isLoading && !error && visible.length === 0 && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center">
            <Icon name="inbox" size="text-4xl" className="text-[var(--ck-text-dim)]" />
            <p className="mt-3 text-sm text-[var(--ck-text-muted)]">No contacts in this tab.</p>
          </div>
        )}

        {visible.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[var(--ck-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ck-surface-elev)] text-left text-xs uppercase tracking-wider text-[var(--ck-text-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold w-[26%]">Name</th>
                  <th className="px-4 py-2.5 font-semibold w-[22%]">Address</th>
                  <th className="px-4 py-2.5 font-semibold w-[12%]">Phone</th>
                  <th className="px-4 py-2.5 font-semibold w-[20%]">Next Activity</th>
                  <th className="px-4 py-2.5 font-semibold w-[16%]">Tags</th>
                  <th className="px-4 py-2.5 font-semibold w-[4%] text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, idx) => {
                  const address = [row.address, row.city].filter(Boolean).join(', ')
                  const stripe = idx % 2 === 0 ? 'bg-[var(--ck-surface)]' : 'bg-[var(--ck-surface-elev)]'
                  const stationColor = STATION_COLORS[row.station] ?? STATION_COLORS.new
                  return (
                    <tr
                      key={row.id}
                      className={`${stripe} border-t border-[var(--ck-border)] hover:bg-[#E32E2E]/5 transition-colors`}
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
                            style={{ backgroundColor: stationColor }}
                          >
                            {initials(row.fullName)}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/leads/${row.id}`}
                              className="block truncate font-semibold text-[var(--ck-text)] hover:text-[#E32E2E]"
                            >
                              {toProperCase(row.fullName || 'Unnamed')}
                            </Link>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: stationColor }}
                              />
                              <span className="text-xs text-[var(--ck-text-dim)] capitalize">
                                {row.station.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)] truncate">{address || '--'}</td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)] whitespace-nowrap font-mono text-xs">
                        {formatPhone(row.phone)}
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)]">
                        {formatNextActivity(row.nextActivity)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {row.tags.length === 0 ? (
                          <span className="text-[var(--ck-text-dim)]">--</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.tags.map((tag) => (
                              <span
                                key={tag}
                                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tagClasses(tag)}`}
                              >
                                {tag.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle text-right">
                        <span
                          className={`inline-block rounded px-2 py-1 text-xs font-bold ${
                            row.score >= 75
                              ? 'bg-[#E32E2E] text-white'
                              : row.score >= 40
                              ? 'bg-[#E32E2E]/20 text-[#E32E2E]'
                              : 'bg-[var(--ck-bg)] text-[var(--ck-text-muted)] border border-[var(--ck-border)]'
                          }`}
                        >
                          {row.score}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
