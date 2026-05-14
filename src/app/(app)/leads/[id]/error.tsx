'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function LeadDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[lead-detail] render error:', error)
  }, [error])

  return (
    <div className="lead-cockpit min-h-screen flex items-center justify-center px-4">
      <div className="max-w-lg w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[#E32E2E] text-3xl">error</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-[var(--ck-text)]">
              This lead failed to render
            </h1>
            <p className="mt-1 text-sm text-[var(--ck-text-muted)]">
              A bad value in this lead&apos;s data crashed the page. The rest of the CRM
              still works.
            </p>
            <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--ck-bg)] border border-[var(--ck-border)] px-3 py-2 text-xs text-[var(--ck-text-muted)] whitespace-pre-wrap break-words">
              {error?.message || 'Unknown error'}
              {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] text-white text-sm font-bold transition-colors"
              >
                Try again
              </button>
              <Link
                href="/contacts"
                className="px-4 py-2 rounded-lg border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] text-sm font-bold transition-colors"
              >
                Back to Contacts
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
