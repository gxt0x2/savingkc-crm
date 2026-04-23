'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { BuyersView } from '@/components/dispo/buyers-view'
import { VendorsView } from '@/components/dispo/vendors-view'

function ContactsTabs() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const urlTab = searchParams.get('tab')
  const initial: 'buyers' | 'vendors' = urlTab === 'vendors' ? 'vendors' : 'buyers'
  const [tab, setTab] = useState<'buyers' | 'vendors'>(initial)

  // Keep URL in sync so links/back-button work
  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString())
    if (tab === 'vendors') sp.set('tab', 'vendors')
    else sp.delete('tab')
    const next = sp.toString()
    const current = searchParams.toString()
    if (next !== current) router.replace(`/dispo/buyers${next ? `?${next}` : ''}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  return (
    <div>
      {/* Tab header */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1">
          {([
            ['buyers', 'Buyers'],
            ['vendors', 'Vendors'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                tab === id
                  ? 'border-[#E32E2E] text-[#E32E2E]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'buyers' ? <BuyersView /> : <VendorsView />}
    </div>
  )
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 text-sm">Loading…</div>}>
      <ContactsTabs />
    </Suspense>
  )
}
