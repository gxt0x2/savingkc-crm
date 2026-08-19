'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TwilioVerificationResult } from '@/lib/support/twilio-verification'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; result: TwilioVerificationResult }
  | { status: 'error' }

const STATUS_LABELS: Record<TwilioVerificationResult['accountApi']['status'], string> = {
  valid: 'Valid',
  invalid_credentials: 'Invalid',
  not_configured: 'Not configured',
  unavailable: 'Provider unavailable',
}

const STATUS_DETAILS: Record<TwilioVerificationResult['accountApi']['status'], string> = {
  valid: 'Verified with one read-only Twilio Account API request.',
  invalid_credentials: 'Twilio rejected the configured Account SID or Auth Token.',
  not_configured: 'The Account SID and Auth Token are not both configured.',
  unavailable: 'Twilio could not be reached or returned an unexpected response.',
}

function StatusPill({ healthy }: { healthy: boolean }) {
  const className = healthy
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${className}`}>
      {healthy ? 'healthy' : 'blocked'}
    </span>
  )
}

function StatusCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--ck-text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-black text-[var(--ck-text)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--ck-text-dim)]">{detail}</p>
    </article>
  )
}

export function TwilioSecurityStatus() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const requestRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setState({ status: 'loading' })

    try {
      const response = await fetch('/api/support/twilio/verify', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (response.status !== 200 && response.status !== 503) throw new Error('Unavailable')
      const result = await response.json() as TwilioVerificationResult
      if (!result?.configuration || !result?.signatureValidation || !result?.accountApi) {
        throw new Error('Invalid response')
      }
      setState({ status: 'ready', result })
    } catch (error) {
      if (controller.signal.aborted) return
      void error
      setState({ status: 'error' })
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }, [])

  useEffect(() => {
    void load()
    return () => requestRef.current?.abort()
  }, [load])

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm" aria-labelledby="telephony-security-heading">
      <div className="flex flex-col gap-2 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="telephony-security-heading" className="text-base font-black text-[var(--ck-text)]">Telephony security</h2>
          <p className="text-xs text-[var(--ck-text-muted)]">Live, read-only verification. Credentials and phone numbers are never displayed.</p>
        </div>
        <div className="flex items-center gap-2">
          {state.status === 'ready' && <StatusPill healthy={state.result.ok} />}
          <button
            type="button"
            onClick={() => void load()}
            disabled={state.status === 'loading'}
            className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-1.5 text-xs font-bold text-[var(--ck-text)] disabled:cursor-wait disabled:opacity-60"
          >
            {state.status === 'loading' ? 'Checking…' : 'Recheck'}
          </button>
        </div>
      </div>
      {state.status === 'loading' && (
        <p className="p-5 text-sm text-[var(--ck-text-muted)]" role="status">Checking Twilio security…</p>
      )}
      {state.status === 'error' && (
        <p className="m-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200" role="alert">
          Twilio verification is unavailable. Refresh this page to retry.
        </p>
      )}
      {state.status === 'ready' && (
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <StatusCard
            label="Auth Token"
            value={STATUS_LABELS[state.result.accountApi.status]}
            detail={STATUS_DETAILS[state.result.accountApi.status]}
          />
          <StatusCard
            label="Webhook signatures"
            value={state.result.signatureValidation.bypassEnabled ? 'Bypass enabled' : 'Enforced'}
            detail={state.result.signatureValidation.bypassEnabled ? 'Production callbacks are not yet protected.' : 'Unsigned provider callbacks are rejected.'}
          />
          <StatusCard
            label="Configuration"
            value={state.result.configuration.accountSidConfigured && state.result.configuration.authTokenConfigured ? 'Complete' : 'Incomplete'}
            detail="Account SID and webhook Auth Token presence only."
          />
        </div>
      )}
    </section>
  )
}
