'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { BuyersView } from '@/components/dispo/buyers-view'
import { VendorsView } from '@/components/dispo/vendors-view'
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

type ContactsTab = 'directory' | 'buyers' | 'vendors'

const CONTACT_TABS: Array<{ key: ContactsTab; label: string; icon: string }> = [
  { key: 'directory', label: 'Directory', icon: 'contacts' },
  { key: 'buyers', label: 'Buyers', icon: 'groups' },
  { key: 'vendors', label: 'Vendors', icon: 'store' },
]

const typeClass: Record<ContactRow['type'], string> = {
  seller: 'border-[#E32E2E]/25 bg-[#fff1f1] text-[#b42318]',
  buyer: 'border-[#86efac] bg-[#e8fff0] text-[#166534]',
  vendor: 'border-[#f7c948] bg-[#fff8db] text-[#8a5a00]',
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
    { label: 'Sellers', value: counts.seller, icon: 'person', tone: 'bg-[#fff1f1] text-[#b42318]' },
    { label: 'Buyers', value: counts.buyer, icon: 'groups', tone: 'bg-[#e8fff0] text-[#166534]' },
    { label: 'Vendors', value: counts.vendor, icon: 'store', tone: 'bg-[#fff8db] text-[#8a5a00]' },
  ]

  return (
    <section>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summaryCards.map((card) => (
          <button
            key={card.label}
            onClick={() => setFilter(card.label.toLowerCase().slice(0, -1) as ContactRow['type'])}
            className="rounded-lg border border-[#d8dee9] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#E32E2E]/35 hover:bg-[#fff7f7]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#697386]">{card.label}</p>
                <p className="mt-1 text-2xl font-black text-[#111827]">{card.value}</p>
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
          <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a8494]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sellers, buyers, vendors..."
            className="w-full rounded-lg border border-[#cad2df] bg-white py-2 pl-9 pr-3 text-sm text-[#111827] outline-none transition placeholder:text-[#7a8494] focus:border-[#E32E2E] focus:ring-2 focus:ring-[#E32E2E]/15"
          />
        </div>
        {(['all', 'seller', 'buyer', 'vendor'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs font-black uppercase transition',
              filter === key
                ? 'border-[#E32E2E] bg-[#E32E2E] text-white'
                : 'border-[#cad2df] bg-white text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'
            )}
          >
            {key === 'all' ? `All ${contacts.length}` : `${key}s ${counts[key]}`}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#E32E2E]/35 bg-[#fff1f1] px-4 py-3 text-sm font-semibold text-[#b42318]">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[#d8dee9] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3 text-[11px] font-black uppercase text-[#697386]">
              <span>Type</span>
              <span>Name</span>
              <span>Context</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Status</span>
            </div>
            {loading ? (
              <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">Loading contacts...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <Icon name="contacts" size="text-3xl" className="mx-auto mb-2 text-[#cad2df]" />
                <p className="text-sm font-bold text-[#253041]">No contacts found.</p>
                <p className="mt-1 text-xs text-[#697386]">Sellers, buyers, and vendors currently tied to the dispo workflow will show here.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#e1e6ee]">
                {filtered.map((contact) => (
                  <Link
                    key={`${contact.type}-${contact.id}`}
                    href={contact.href}
                    className="grid grid-cols-[0.7fr_1.4fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 text-sm transition hover:bg-[#fff7f7]"
                  >
                    <span>
                      <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', typeClass[contact.type])}>
                        {contact.type}
                      </span>
                    </span>
                    <span className="min-w-0 truncate font-bold text-[#111827]">{contact.name}</span>
                    <span className="truncate text-[#4b5565]">{contact.context || '-'}</span>
                    <span className="truncate text-[#4b5565]">{contact.phone || '-'}</span>
                    <span className="truncate text-[#4b5565]">{contact.email || '-'}</span>
                    <span className="truncate text-[#4b5565]">{contact.status || '-'}</span>
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab')
  const activeTab: ContactsTab = tabParam === 'buyers' || tabParam === 'vendors' ? tabParam : 'directory'

  function setActiveTab(tab: ContactsTab) {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'directory') params.delete('tab')
    else params.set('tab', tab)
    const next = params.toString()
    router.replace(`/dispo/contacts${next ? `?${next}` : ''}`, { scroll: false })
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-[#111827]">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-[#d8dee9] pb-5">
          <div>
            <p className="mb-1 text-xs font-black uppercase text-[#E32E2E]">Dispositions / Contacts</p>
            <h1 className="text-2xl font-black tracking-tight text-[#111827]">Shared Contacts</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#4b5565]">
              Sellers, buyers, title, contractors, and active vendors available to both the Dispo and TC workflows.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dispo/tc"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#cad2df] bg-white px-3 py-2 text-sm font-bold text-[#253041] transition hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]"
            >
              <Icon name="fact_check" size="text-sm" />
              TC
            </Link>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {CONTACT_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-black transition',
                activeTab === tab.key
                  ? 'border-[#E32E2E] bg-[#E32E2E] text-white'
                  : 'border-[#cad2df] bg-white text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'
              )}
            >
              <Icon name={tab.icon} size="text-sm" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'directory' && <DirectoryView />}
        {activeTab === 'buyers' && <BuyersView />}
        {activeTab === 'vendors' && <VendorsView />}
      </div>
    </main>
  )
}

export default function DispoContactsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm font-semibold text-[#697386]">Loading contacts...</div>}>
      <ContactsPortal />
    </Suspense>
  )
}
