'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
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
  seller: 'bg-[#E32E2E]/15 text-[#ff8b8b] border-[#E32E2E]/30',
  buyer: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  vendor: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

export default function DispoContactsPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContactRow['type'] | 'all'>('all')
  const [loading, setLoading] = useState(true)

  async function loadContacts(q = '') {
    setLoading(true)
    const res = await fetch(`/api/dispo/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
    const data = await res.json()
    setContacts(data.contacts ?? [])
    setLoading(false)
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

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Contacts</h1>
            <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Sellers, buyers, and vendors in one TC-ready contact list.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/dispo/buyers" className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/5">Manage Buyers</Link>
            <Link href="/dispo/vendors" className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/5">Manage Vendors</Link>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[280px] flex-1">
            <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sellers, buyers, vendors..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[#E32E2E]/60"
            />
          </div>
          {(['all', 'seller', 'buyer', 'vendor'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-lg px-3 py-2 text-xs font-black uppercase',
                filter === key ? 'bg-[#E32E2E] text-white' : 'border border-white/10 text-[var(--ck-text-muted)] hover:bg-white/5'
              )}
            >
              {key === 'all' ? `All ${contacts.length}` : `${key}s ${counts[key]}`}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#141414]">
          <div className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">
            <span>Type</span>
            <span>Name</span>
            <span>Context</span>
            <span>Phone</span>
            <span>Email</span>
            <span>Status</span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">Loading contacts...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">No contacts found.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filtered.map((contact) => (
                <Link
                  key={`${contact.type}-${contact.id}`}
                  href={contact.href}
                  className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 text-sm hover:bg-white/[0.04]"
                >
                  <span><span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', typeClass[contact.type])}>{contact.type}</span></span>
                  <span className="min-w-0 font-bold text-white truncate">{contact.name}</span>
                  <span className="truncate text-[var(--ck-text-muted)]">{contact.context || '—'}</span>
                  <span className="truncate text-[var(--ck-text-muted)]">{contact.phone || '—'}</span>
                  <span className="truncate text-[var(--ck-text-muted)]">{contact.email || '—'}</span>
                  <span className="truncate text-[var(--ck-text-muted)]">{contact.status || '—'}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
