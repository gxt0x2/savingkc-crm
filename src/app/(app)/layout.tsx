import { Suspense } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Providers } from '@/lib/providers'

function AppShellLoading() {
  return (
    <div aria-label="Loading CRM workspace" className="flex h-screen overflow-hidden bg-[var(--crm-canvas)]">
      <aside className="hidden w-[230px] shrink-0 border-r border-black/15 bg-[var(--crm-nav)] lg:block">
        <div className="h-[76px] border-b border-white/10" />
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-11 animate-pulse rounded-lg bg-white/5" />)}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="h-[62px] border-b border-[var(--crm-border)] bg-[var(--crm-surface)]" />
        <div className="animate-pulse space-y-4 p-6">
          <div className="h-8 w-64 rounded-lg bg-[var(--crm-surface-subtle)]" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-36 rounded-2xl bg-[var(--crm-surface)]" />
            <div className="h-36 rounded-2xl bg-[var(--crm-surface)]" />
            <div className="h-36 rounded-2xl bg-[var(--crm-surface)]" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Suspense fallback={<AppShellLoading />}><AppShell>{children}</AppShell></Suspense>
    </Providers>
  )
}
