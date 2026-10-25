export default function WebsiteConversionLoading() {
  return (
    <main aria-label="Loading website conversion" className="mx-auto w-full max-w-[1720px] space-y-3 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <span className="sr-only">Loading website conversion</span>
      <header className="animate-pulse rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 py-4">
        <div className="h-3 w-40 rounded-full bg-[var(--crm-brand-soft)]" />
        <div className="mt-2 h-7 w-72 rounded-lg bg-[var(--crm-surface-subtle)]" />
      </header>
      <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)]" />)}
      </div>
    </main>
  )
}
