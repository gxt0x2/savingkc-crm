'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import styles from './email-workspace.module.css'
import { EmailDomains } from './email-domains'

type Connection = {
  id: string
  provider: string
  account_label: string
  masked_secret: string
  state: string
  failure_code: string | null
  checked_at: string | null
}
type State = {
  disconnectImpact: {
    hash: string
    activeCampaigns: number
    queuedMessages: number
  }
  ai: {
    configured: boolean
    lastState: string | null
    failureCode: string | null
  }
  configured: boolean
  revision: number
  connections: Connection[]
}
const reasons: Record<string, string> = {
  CREDENTIAL_STORAGE_REQUIRED:
    'Secure credential storage needs configuration before a key can be saved.',
  CONNECTION_IMPACT_CHANGED:
    'Queued work changed. Refresh and review the impact before disconnecting.',
  SERVICE_KEY_INVALID:
    'Resend rejected this key. Check the key in your Resend account.',
  SERVICE_SCOPE_REQUIRED:
    'This key cannot read domains or received email. Use a key with those permissions.',
  SERVICE_RATE_LIMIT:
    'Resend is limiting checks. Wait a little before trying again.',
  SERVICE_UNREACHABLE:
    'Resend could not be reached. The previous connection is unchanged.',
  SERVICE_CHECK_FAILED:
    'The connection check failed. The previous connection is unchanged.',
  SERVICE_REVIEW_CHANGED:
    'Setup or owner access changed during this check. Review settings and submit again.',
  REVISION_CONFLICT: 'Setup changed. Refresh this section before connecting.',
  SERVICE_CHECK_LIMIT:
    'Ten connection checks have been attempted in the last hour. Try again later.',
}
export function EmailConnections() {
  const [data, setData] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const secret = useRef<HTMLInputElement>(null)
  const requestSequence = useRef(0)
  async function refresh() {
    const sequence = ++requestSequence.current
    try {
      const response = await fetch('/api/email/connections', {
        cache: 'no-store',
      })
      const result = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok)
        throw new Error('Connections could not be loaded. Try refreshing.')
      setData(result)
    } catch {
      if (sequence === requestSequence.current)
        setNotice('Connections could not be loaded. Try refreshing.')
    }
  }
  useEffect(() => {
    void refresh()
    // This is a request counter, not a DOM node; cleanup invalidates the latest request.
    const counter = requestSequence
    return () => {
      counter.current++
    }
  }, [])
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data || busy) return
    const form = new FormData(event.currentTarget)
    const payload = {
      kind: 'email',
      provider: 'resend',
      accountLabel: String(form.get('accountLabel') ?? ''),
      secret: secret.current?.value ?? '',
      expectedRevision: data.revision,
      idempotencyKey: crypto.randomUUID(),
    }
    if (secret.current) secret.current.value = ''
    setBusy(true)
    setNotice('Checking Resend access…')
    const sequence = ++requestSequence.current
    try {
      const response = await fetch('/api/email/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok) {
        setNotice(
          reasons[result.error?.code] ??
            'The connection could not be saved. Review setup and try again.',
        )
        return
      }
      setData(result)
      const connection = result.connections.find(
        (c: Connection) => c.id === result.connectionId,
      )
      setNotice(
        connection?.state === 'checked'
          ? 'Read access checked. Sender setup and delivery checks are still required.'
          : (reasons[connection?.failure_code ?? ''] ??
              'The connection is still being checked. Refresh for its result.'),
      )
    } catch {
      if (sequence === requestSequence.current)
        setNotice(
          'The result could not be retrieved. Refresh before trying again.',
        )
    } finally {
      payload.secret = ''
      setBusy(false)
    }
  }
  async function disconnect(
    event: FormEvent<HTMLFormElement>,
    connectionId: string,
  ) {
    event.preventDefault()
    if (!data || busy) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
    setBusy(true)
    const sequence = ++requestSequence.current
    try {
      const response = await fetch('/api/email/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          reason,
          expectedRevision: data.revision,
          confirmedAffectedHash: data.disconnectImpact.hash,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const result = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok) {
        setNotice(
          reasons[result.error?.code] ??
            'Could not disconnect. Refresh and review this connection.',
        )
        return
      }
      setData(result)
      setNotice(
        'Disconnected locally. Email work is paused. Existing conversation history is preserved.',
      )
    } catch {
      setNotice(
        'The result could not be retrieved. Refresh before trying again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <h3>Connections</h3>
        <button onClick={refresh} disabled={busy}>
          Refresh connections
        </button>
      </div>
      <p>
        Connect your existing services here. Sending stays off until sender
        setup and delivery checks pass.
      </p>
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Resend connection">
        <h4>Email · Resend</h4>
        {!data ? (
          <p>Loading connection status…</p>
        ) : (
          <>
            {!data.configured && (
              <p>
                Secure credential storage needs configuration. Do not paste a
                real key into this practice workspace.
              </p>
            )}
            <form onSubmit={connect} className={styles.form}>
              <label>
                Account label
                <input
                  name="accountLabel"
                  required
                  maxLength={120}
                  placeholder="SavingKC outreach"
                  disabled={!data.configured || busy}
                />
              </label>
              <label>
                Resend API key
                <input
                  ref={secret}
                  type="password"
                  name="resendKey"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={203}
                  disabled={!data.configured || busy}
                />
              </label>
              <small>
                Checks domain and receiving access. The key is encrypted and
                never shown again. This does not start sending or purchase a
                subscription.
              </small>
              <button
                className={styles.primary}
                disabled={!data.configured || busy}
              >
                {busy ? 'Checking…' : 'Check & save connection'}
              </button>
            </form>
            {data.connections.map((c) => (
              <article className={styles.agendaItem} key={c.id}>
                <strong>{c.account_label}</strong>
                <p>
                  {c.masked_secret} ·{' '}
                  {c.state === 'checked'
                    ? 'Read access checked'
                    : c.state === 'failed'
                      ? 'Needs attention'
                      : c.state === 'revoked'
                        ? 'Disconnected'
                        : 'Checking'}
                </p>
                {c.failure_code && (
                  <p>
                    {reasons[c.failure_code] ??
                      'Review this connection before continuing.'}
                  </p>
                )}
                {c.checked_at && (
                  <small>
                    Checked {new Date(c.checked_at).toLocaleString()}
                  </small>
                )}
                {c.state === 'checked' && (
                  <p>
                    Next: choose an independent sender domain, verify DNS, and
                    test delivery and replies.
                  </p>
                )}
                {c.state !== 'revoked' && data.configured && (
                  <details>
                    <summary>Disconnect</summary>
                    <form
                      onSubmit={(event) => disconnect(event, c.id)}
                      className={styles.form}
                    >
                      <p>
                        This removes this saved key and pauses all Email work:{' '}
                        {data.disconnectImpact.activeCampaigns} active campaigns
                        and {data.disconnectImpact.queuedMessages} queued
                        messages. Conversation history stays available. It does
                        not delete your Resend account.
                      </p>
                      <label>
                        Reason
                        <input
                          name="reason"
                          required
                          maxLength={500}
                          disabled={busy}
                        />
                      </label>
                      <button className={styles.danger} disabled={busy}>
                        Disconnect & pause email
                      </button>
                    </form>
                  </details>
                )}
                {c.state === 'checking' && (
                  <p>
                    Refresh for the result. If a check was interrupted, submit
                    the key again; sending remains off.
                  </p>
                )}
              </article>
            ))}
          </>
        )}
      </section>
      <EmailDomains />
      <section>
        <h4>Ari</h4>
        <p>
          {data?.ai.failureCode === 'AI_CREDITS_REQUIRED'
            ? 'The last model check requires paid AI credits. An owner can add credits in Vercel, then retry a draft.'
            : data?.ai.configured
              ? 'AI credentials are available. Drafts require human approval; a successful draft is still needed to verify inference.'
              : 'AI access needs configuration. Drafts will require human approval and spending limits.'}
        </p>
      </section>
      <section>
        <h4>Google Calendar</h4>
        <p>
          Existing CRM connections will be reused when access is verified. CRM
          follow-up tasks already work; Google events are not connected to Email
          yet.
        </p>
      </section>
      <section>
        <h4>Caller number & notifications</h4>
        <p>
          Private Email alerts are available in the header. External
          notifications and a dedicated response number still need setup.
        </p>
      </section>
    </div>
  )
}
