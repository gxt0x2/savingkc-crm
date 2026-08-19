'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'

interface InClosingRow {
  composite_score: number
  lead_id: string
  last_scored_at: string | null
  raw_inputs: unknown
  leads: {
    id: string
    full_name: string | null
    phone: string | null
    station: string
    property_address: string | null
    city: string | null
  } | null
}

interface InClosingResponse {
  items: InClosingRow[]
  surface: 'in_closing'
}

function useInClosingList() {
  return useQuery<InClosingResponse>({
    queryKey: ['hot-opportunities', 'in_closing'],
    queryFn: async () => {
      const res = await fetch('/api/hot-opportunities?surface=in_closing')
      if (!res.ok) throw new Error('Failed to fetch in-closing list')
      return res.json()
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
}

export default function InClosingPage() {
  const { data, isLoading, error } = useInClosingList()

  const items = data?.items ?? []

  return (
    <div className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-text)]">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6 flex items-center gap-3">
          <Icon name="gavel" size="text-3xl" className="text-[#E32E2E]" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">In Closing</h1>
            <p className="text-sm text-[var(--ck-text-muted)]">
              Deals under contract, in inspection, or closing prep.
            </p>
          </div>
        </header>

        {isLoading && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center text-sm text-[var(--ck-text-muted)]">
            Loading closing pipeline...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-4 text-sm text-[#E32E2E]">
            Failed to load: {error instanceof Error ? error.message : 'unknown error'}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-8 text-center">
            <Icon name="inbox" size="text-4xl" className="text-[var(--ck-text-dim)]" />
            <p className="mt-3 text-sm font-medium text-[var(--ck-text)]">No deals in closing right now.</p>
            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">
              When a lead moves to <span className="font-mono">under_contract</span>, they&apos;ll show up here.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((row, idx) => {
              const lead = row.leads
              if (!lead) return null
              const fullName = lead.full_name || 'Unnamed seller'
              const address = [lead.property_address, lead.city].filter(Boolean).join(', ')
              const score = Math.round(row.composite_score ?? 0)
              const surfaceClass = idx % 2 === 0 ? 'bg-[var(--ck-surface-elev)]' : 'bg-[var(--ck-surface)]'

              return (
                <li
                  key={lead.id}
                  className={`${surfaceClass} rounded-lg border border-[var(--ck-border)] p-4 hover:border-[#E32E2E]/40 transition-colors`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/leads/${lead.id}`}
                        prefetch={false}
                        className="text-base font-bold text-[var(--ck-text)] hover:text-[#E32E2E] transition-colors"
                      >
                        {toProperCase(fullName)}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ck-text-muted)]">
                        {address && (
                          <span className="flex items-center gap-1">
                            <Icon name="home" size="text-sm" className="text-[var(--ck-text-dim)]" />
                            {address}
                          </span>
                        )}
                        {lead.phone && (
                          <span className="flex items-center gap-1">
                            <Icon name="phone" size="text-sm" className="text-[var(--ck-text-dim)]" />
                            {lead.phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Icon name="schedule" size="text-sm" className="text-[var(--ck-text-dim)]" />
                          last scored {row.last_scored_at ? new Date(row.last_scored_at).toLocaleDateString() : 'never'}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="rounded-md bg-[#E32E2E] px-3 py-1 text-sm font-bold text-white">
                        {score}
                      </div>
                      <Link
                        href={`/leads/${lead.id}`}
                        prefetch={false}
                        className="rounded-md border border-[var(--ck-border)] bg-[var(--ck-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ck-text)] hover:border-[#E32E2E]/40 hover:text-[#E32E2E] transition-colors"
                      >
                        Open
                      </Link>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
