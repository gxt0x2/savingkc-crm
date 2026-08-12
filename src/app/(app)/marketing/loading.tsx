export default function MarketingDashboardLoading() {
  return (
    <main aria-label="Loading Google Ads performance" className="mx-auto w-full max-w-[1720px] space-y-3 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <span className="sr-only">Loading Google Ads performance</span>
      <header className="animate-pulse rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 py-4 shadow-[var(--crm-shadow-sm)]">
        <div className="h-3 w-44 rounded-full bg-[var(--crm-brand-soft)]" />
        <div className="mt-2 h-7 w-72 rounded-lg bg-[var(--crm-surface-subtle)]" />
        <div className="mt-2 h-3 w-[min(36rem,80%)] rounded-full bg-[var(--crm-surface-subtle)]" />
      </header>
      <div className="grid animate-pulse gap-2 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-11 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)]" />)}
      </div>
      <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-32 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]" />)}
      </div>
      <div className="grid animate-pulse gap-3 xl:grid-cols-2">
        <div className="h-72 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]" />
        <div className="h-72 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]" />
      </div>
    </main>
  )
}
