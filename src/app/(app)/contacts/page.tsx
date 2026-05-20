'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import {
  formatDurationBetween,
  formatLeadSource,
  getAvatarLabel,
  getDisplayLeadName,
  isGoogleAdsSource,
  shouldUsePhoneAsName,
  type ContactSignal,
} from '@/lib/contact-display'
import { FavoriteToggle } from '@/components/leads/favorite-toggle'
import { StageSelector } from '@/components/leads/stage-selector'
import type { DealStage } from '@/types/pipeline'

interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  source: string | null
  address: string | null
  city: string | null
  station: DealStage
  score: number
  isFavorite: boolean
  nextActivity: {
    when: string | null
    label: string
    kind: 'appointment' | 'recommended' | null
  } | null
  tags: string[]
  lastContactAt: string | null
  createdAt: string | null
  firstOutboundAt: string | null
  contactSignal: ContactSignal | null
  updatedAt: string | null
}

interface ContactsResponse {
  items: ContactRow[]
}

type TabKey = 'all' | 'hot' | 'new' | 'contacted' | 'qualified' | 'appointment_set' | 'offer_made' | 'in_closing'

const LEAD_GROUP_SESSION_KEY = 'savingkc:lead-group:v1'

const TABS: { key: TabKey; label: string; station?: DealStage; minScore?: number }[] = [
  { key: 'hot', label: 'Hot', minScore: 75 },
  { key: 'new', label: 'New', station: 'new' },
  { key: 'contacted', label: 'Leads', station: 'contacted' },
  { key: 'qualified', label: 'Opportunities', station: 'qualified' },
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

const NEXT_ACTIVITY_CLAMP: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 3,
}

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

export default function ContactsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('hot')
  const [nowTs, setNowTs] = useState(() => Date.now())
  const { data, isLoading, error } = useContacts()
  const queryClient = useQueryClient()

  const items = useMemo(() => data?.items ?? [], [data])

  const refreshContacts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['contacts'] })
  }, [queryClient])

  // The API returns the active lead set: non-parked and not archived/dead.
  // Working-queue tabs keep under_contract exclusive to In Closing, while All
  // shows the total active lead count and list.
  const acquisitionOnly = useMemo(() => items.filter((i) => i.station !== 'under_contract'), [items])

  // Hot = composite score ≥ 75 OR manually starred (is_favorite).
  // The star on the lead page is the canonical manual-hot signal.
  const isHot = useCallback((row: ContactRow) => row.score >= 75 || row.isFavorite, [])

  const counts = useMemo<Record<TabKey, number>>(() => {
    return {
      all: items.length,
      hot: acquisitionOnly.filter(isHot).length,
      new: acquisitionOnly.filter((i) => i.station === 'new').length,
      contacted: acquisitionOnly.filter((i) => i.station === 'contacted').length,
      qualified: acquisitionOnly.filter((i) => i.station === 'qualified').length,
      appointment_set: acquisitionOnly.filter((i) => i.station === 'appointment_set').length,
      offer_made: acquisitionOnly.filter((i) => i.station === 'offer_made').length,
      in_closing: items.filter((i) => i.station === 'under_contract').length,
    }
  }, [items, acquisitionOnly, isHot])

  const visible = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab)
    if (!tab) return items
    const pool = activeTab === 'all' || activeTab === 'in_closing' ? items : acquisitionOnly
    let filtered = pool
    if (tab.station) filtered = filtered.filter((i) => i.station === tab.station)
    if (activeTab === 'hot') filtered = filtered.filter(isHot)
    if (activeTab === 'new') {
      return [...filtered].sort((a, b) => {
        if (Boolean(a.firstOutboundAt) !== Boolean(b.firstOutboundAt)) {
          return a.firstOutboundAt ? 1 : -1
        }
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      })
    }
    return [...filtered].sort((a, b) => b.score - a.score)
  }, [items, acquisitionOnly, activeTab, isHot])

  const saveLeadGroup = useCallback(() => {
    if (typeof window === 'undefined') return
    if (visible.length === 0) {
      window.sessionStorage.removeItem(LEAD_GROUP_SESSION_KEY)
      return
    }

    const activeTabMeta = TABS.find((tab) => tab.key === activeTab)
    window.sessionStorage.setItem(LEAD_GROUP_SESSION_KEY, JSON.stringify({
      source: 'contacts',
      returnPath: '/contacts',
      label: activeTabMeta?.label || 'Contacts',
      savedAt: new Date().toISOString(),
      ids: visible.map((row) => row.id),
      items: visible.map((row) => ({
        id: row.id,
        name: getDisplayLeadName(row.fullName, row.phone),
        address: [row.address, row.city].filter(Boolean).join(', ') || row.address,
      })),
    }))
  }, [activeTab, visible])

  useEffect(() => {
    saveLeadGroup()
  }, [saveLeadGroup])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-text)]">
      <div className="mx-auto max-w-[1536px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
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
          <div className="overflow-x-auto rounded-lg border border-[var(--ck-border)]">
            <table className="min-w-[1600px] w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[56px]" />
                <col className="w-[18%]" />
                <col className="w-[140px]" />
                <col className="w-[150px]" />
                <col className="w-[20%]" />
                <col className="w-[145px]" />
                <col className="w-[155px]" />
                <col className="w-[155px]" />
                <col className="w-[18%]" />
                <col className="w-[170px]" />
                <col className="w-[72px]" />
              </colgroup>
              <thead className="bg-[var(--ck-surface-elev)] text-left text-xs uppercase tracking-wider text-[var(--ck-text-muted)]">
                <tr>
                  <th className="px-3 py-2.5 font-semibold"></th>
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                  <th className="px-4 py-2.5 font-semibold">Stage</th>
                  <th className="px-4 py-2.5 font-semibold">Address</th>
                  <th className="px-4 py-2.5 font-semibold">Phone</th>
                  <th className="px-4 py-2.5 font-semibold">Last Signal</th>
                  <th className="px-4 py-2.5 font-semibold">Time in System</th>
                  <th className="px-4 py-2.5 font-semibold">Next Activity</th>
                  <th className="px-4 py-2.5 font-semibold">Tags</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, idx) => {
                  const address = [row.address, row.city].filter(Boolean).join(', ')
                  const stripe = idx % 2 === 0 ? 'bg-[var(--ck-surface)]' : 'bg-[var(--ck-surface-elev)]'
                  const stationColor = STATION_COLORS[row.station] ?? STATION_COLORS.new
                  const nextActivity = formatNextActivity(row.nextActivity)
                  const shownTags = row.tags.slice(0, 4)
                  const extraTagCount = row.tags.length - shownTags.length
                  const displayName = getDisplayLeadName(row.fullName, row.phone)
                  const usesPhoneName = shouldUsePhoneAsName(row.fullName)
                  const sourceLabel = formatLeadSource(row.source)
                  const avatarText = getAvatarLabel(row.fullName, row.phone, row.source)
                  const avatarColor = isGoogleAdsSource(row.source) ? '#E32E2E' : stationColor
                  const timerLabel = formatDurationBetween(row.createdAt, row.firstOutboundAt, nowTs)
                  const timerState = row.firstOutboundAt
                    ? 'Stopped at first outbound'
                    : row.station === 'new'
                      ? 'Running'
                      : 'No outbound yet'
                  const timerNeedsAttention = row.station === 'new' && !row.firstOutboundAt
                  return (
                    <tr
                      key={row.id}
                      className={`${stripe} border-t border-[var(--ck-border)] hover:bg-[#E32E2E]/5 transition-colors`}
                    >
                      <td className="px-3 py-3 align-middle">
                        <FavoriteToggle leadId={row.id} isFavorite={row.isFavorite} size="md" />
                      </td>
                      <td className="px-4 py-3 align-middle min-w-0">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
                            style={{ backgroundColor: avatarColor }}
                          >
                            {avatarText}
                          </div>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/leads/${row.id}`}
                              onClick={saveLeadGroup}
                              className="block truncate font-semibold text-[var(--ck-text)] hover:text-[#E32E2E]"
                            >
                              {displayName}
                            </Link>
                            {usesPhoneName && (
                              <span className="block truncate text-[11px] text-[var(--ck-text-dim)]">
                                No caller name
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)]">
                        <span className={isGoogleAdsSource(row.source) ? 'font-semibold text-[#E32E2E]' : ''}>
                          {sourceLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <StageSelector
                          leadId={row.id}
                          station={row.station}
                          size="sm"
                          onChange={refreshContacts}
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)]">
                        <div className="truncate" title={address || undefined}>{address || '--'}</div>
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)] whitespace-nowrap font-mono text-xs">
                        {formatPhone(row.phone)}
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)]">
                        {row.contactSignal ? (
                          <div className="leading-5">
                            <div className="font-medium text-[var(--ck-text)]">{row.contactSignal.label}</div>
                            {row.contactSignal.at && (
                              <div className="text-[11px] text-[var(--ck-text-dim)]">
                                {formatDurationBetween(row.contactSignal.at, null, nowTs)} ago
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--ck-text-dim)]">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div
                          className={`inline-flex min-w-[118px] flex-col items-center justify-center rounded-full border px-3 py-1.5 text-center shadow-sm ${
                            timerNeedsAttention
                              ? 'animate-pulse border-[#E32E2E]/50 bg-[#E32E2E]/15 text-[#E32E2E] shadow-[#E32E2E]/10'
                              : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
                          }`}
                          title={timerNeedsAttention ? 'Needs first outbound attempt' : 'First outbound attempt completed'}
                        >
                          <div className="text-sm font-black leading-none">
                            {timerLabel}
                          </div>
                          <div className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${timerNeedsAttention ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'}`}>
                            {timerState}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-[var(--ck-text-muted)]">
                        <div className="overflow-hidden leading-5" style={NEXT_ACTIVITY_CLAMP} title={nextActivity}>
                          {nextActivity}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {row.tags.length === 0 ? (
                          <span className="text-[var(--ck-text-dim)]">--</span>
                        ) : (
                          <div className="flex flex-wrap gap-1" title={row.tags.map((tag) => tag.replace(/_/g, ' ')).join(', ')}>
                            {shownTags.map((tag) => (
                              <span
                                key={tag}
                                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tagClasses(tag)}`}
                              >
                                {tag.replace(/_/g, ' ')}
                              </span>
                            ))}
                            {extraTagCount > 0 && (
                              <span className="rounded border border-[var(--ck-border)] bg-[var(--ck-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ck-text-muted)]">
                                +{extraTagCount}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle text-right">
                        <span
                          className={`inline-block rounded px-2 py-1 text-xs font-bold ${
                            isHot(row)
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
