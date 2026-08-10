'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { DispoPageHeader } from '@/components/dispo/workspace-ui'
import { cn } from '@/lib/utils'

interface ContactRow {
  id: string
  type: 'seller' | 'buyer' | 'vendor'
  name: string
  company: string | null
  phone: string | null
  email: string | null
  context: string | null
  status: string | null
  href: string
  updated_at: string | null
}

const typeClass: Record<ContactRow['type'], string> = {
  seller: 'border-[var(--crm-brand)]/25 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  buyer: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  vendor: 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
}

function DirectoryView() {
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContactRow['type'] | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadContacts(q = '') {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dispo/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts')
      setContacts(data.contacts ?? [])
    } catch (err) {
      setContacts([])
      setError(err instanceof Error ? err.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadContacts()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => loadContacts(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const filtered = useMemo(() => {
    if (filter === 'all') return contacts
    return contacts.filter((contact) => contact.type === filter)
  }, [contacts, filter])

  const counts = useMemo(() => ({
    seller: contacts.filter((contact) => contact.type === 'seller').length,
    buyer: contacts.filter((contact) => contact.type === 'buyer').length,
    vendor: contacts.filter((contact) => contact.type === 'vendor').length,
  }), [contacts])

  const summaryCards = [
    { label: 'Sellers', value: counts.seller, icon: 'person', tone: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' },
    { label: 'Buyers', value: counts.buyer, icon: 'groups', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' },
    { label: 'Vendors', value: counts.vendor, icon: 'store', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
  ]

  return (
    <section>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <button
            key={card.label}
            onClick={() => setFilter(card.label.toLowerCase().slice(0, -1) as ContactRow['type'])}
            className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3 text-left shadow-sm transition hover:border-[var(--crm-brand)]/35 hover:bg-[var(--crm-brand-soft)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[var(--crm-text-muted)]">{card.label}</p>
                <p className="mt-1 text-2xl font-black text-[var(--crm-ink)]">{card.value}</p>
              </div>
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', card.tone)}>
                <Icon name={card.icon} size="text-xl" />
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sellers, buyers, vendors..."
            className="w-full rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] py-2 pl-9 pr-3 text-sm text-[var(--crm-ink)] outline-none transition placeholder:text-[var(--crm-text-dim)] focus:border-[var(--crm-brand)] focus:ring-2 focus:ring-[var(--crm-brand)]/15"
          />
        </div>
        {(['all', 'seller', 'buyer', 'vendor'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs font-black uppercase transition',
              filter === key
                ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-[var(--crm-on-brand)]'
                : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]'
            )}
          >
            {key === 'all' ? `All ${contacts.length}` : `${key}s ${counts[key]}`}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3 text-[11px] font-black uppercase text-[var(--crm-text-muted)]">
              <span>Type</span>
              <span>Name</span>
              <span>Context</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Status</span>
            </div>
            {loading ? (
              <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading contacts...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <Icon name="contacts" size="text-3xl" className="mx-auto mb-2 text-[var(--crm-border-strong)]" />
                <p className="text-sm font-bold text-[var(--crm-text)]">No contacts found.</p>
                <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Sellers, buyers, and vendors currently tied to the dispo workflow will show here.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--crm-border)]">
                {filtered.map((contact) => (
                  <Link
                    key={`${contact.type}-${contact.id}`}
                    href={contact.href}
                    className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 text-sm transition hover:bg-[var(--crm-brand-soft)]"
                  >
                    <span>
                      <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', typeClass[contact.type])}>
                        {contact.type}
                      </span>
                    </span>
                    <span className="min-w-0 truncate font-bold text-[var(--crm-ink)]">{contact.name}</span>
                    <span className="truncate text-[var(--crm-text-muted)]">{contact.context || '-'}</span>
                    <span className="truncate text-[var(--crm-text-muted)]">{contact.phone || '-'}</span>
                    <span className="truncate text-[var(--crm-text-muted)]">{contact.email || '-'}</span>
                    <span className="truncate text-[var(--crm-text-muted)]">{contact.status || '-'}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function ContactsPortal() {
  return (
    <main className="min-h-screen bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 overflow-hidden rounded-xl border border-[var(--crm-border)] shadow-[var(--crm-shadow-sm)]">
          <DispoPageHeader
            eyebrow="Dispositions"
            title="Contacts"
            description="One directory for sellers, buyers, title companies, contractors, and everyone involved in a transaction."
            actions={(
              <Link href="/dispo/tc" className="crm-secondary-button inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold">
                <Icon name="fact_check" size="text-sm" />
                Open closing
              </Link>
            )}
          />
        </div>
        <DirectoryView />
      </div>
    </main>
  )
}

export default function DispoContactsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm font-semibold text-[var(--crm-text-muted)]">Loading contacts...</div>}>
      <ContactsPortal />
    </Suspense>
  )
}
