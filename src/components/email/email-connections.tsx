'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import styles from './email-workspace.module.css'
import { EmailDomains } from './email-domains'
import {
  PRIMARY_BUSINESS_DOMAIN,
  intendedOutreachDomainNames,
  intendedOutreachOpsBrief,
} from '@/lib/email/domains/intended'
import {
  EMAIL_CONNECTIONS_SECRET_CONTRACT,
  EMAIL_FLAGS_MUST_STAY_OFF,
  EMAIL_HOSTED_SECRETS,
  EMAIL_HOSTED_SECRET_PRESENCE,
  EMAIL_RESEND_PRODUCT_KEY_LABEL,
  EMAIL_SECRETS_NOT_THIS_PRODUCT,
} from '@/lib/email/secrets-contract'

type Connection = {
  id: string
  provider: string
  account_label: string
  masked_secret: string
  state: string
  failure_code: string | null
  checked_at: string | null
}
type Webhook = {
  id: string
  connection_id: string
  active: boolean
  revision: number
  masked_secret: string | null
  key_version: number
}
type State = {
  disconnectImpact: {
    hash: string
    activeCampaigns: number
    queuedMessages: number
  }
  replacementReview?: {
    hash: string
    historicalAccounts: number
    domainsByConnection: Record<string, number>
    eventsByConnection: Record<string, number>
  }
  webhooks?: Webhook[]
  credentialStorage?: {
    configured: boolean
    currentVersion: number | null
    storedVersions: number[]
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
  CREDENTIAL_KEY_VERSION_REQUIRED:
    'An older encryption key is still needed to read a saved secret. Keep the previous key until rotation finishes.',
  CONNECTION_ALREADY_REVIEWED:
    'This historical account already has a replacement review.',
  INVALID_WEBHOOK_SECRET:
    'Paste the Resend webhook signing secret. This does not create a live endpoint.',
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
  async function lifecycle(
    action: string,
    extra: Record<string, unknown>,
    ok: string,
  ) {
    if (!data || busy) return
    setBusy(true)
    const sequence = ++requestSequence.current
    try {
      const response = await fetch('/api/email/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          expectedRevision: data.revision,
          idempotencyKey: crypto.randomUUID(),
          ...extra,
        }),
      })
      const result = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok) {
        setNotice(
          reasons[result.error?.code] ??
            'Could not update this connection. Refresh and review the current records.',
        )
        return
      }
      setData(result)
      setNotice(ok)
    } catch {
      if (sequence === requestSequence.current)
        setNotice('The result could not be retrieved. Refresh before trying again.')
    } finally {
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
        Connect your existing services here. Sending stays off until the Email
        product API key, hosted secrets and release auth are in place. Owned
        outreach domains ({intendedOutreachDomainNames().join(', ')}) have
        ops-verified Cloudflare DNS-only records (
        {intendedOutreachOpsBrief()}). This screen does not treat that ops
        work as sending-ready.{' '}
        {PRIMARY_BUSINESS_DOMAIN} stays the primary business domain and cannot
        be a campaign sender.
      </p>
      <details>
        <summary>Hosted secrets this screen expects</summary>
        <p>
          Robin can wire these hosted names in parallel. They do not unlock
          live send. The named Resend key {EMAIL_RESEND_PRODUCT_KEY_LABEL}{' '}
          exists off-chat.
          Paste it here as <code>re_</code> after{' '}
          {EMAIL_CONNECTIONS_SECRET_CONTRACT.credentialsKey} is present (
          {EMAIL_CONNECTIONS_SECRET_CONTRACT.resendApiKey.intake}). Do not use{' '}
          {EMAIL_SECRETS_NOT_THIS_PRODUCT[0]} for Email — that env belongs to
          Conversations. Hosted names may be present and still not live (
          {EMAIL_CONNECTIONS_SECRET_CONTRACT.hostedPresence}):{' '}
          <code>{EMAIL_HOSTED_SECRET_PRESENCE.EMAIL_CREDENTIALS_KEY_V1.name}</code>{' '}
          is set on {EMAIL_HOSTED_SECRET_PRESENCE.EMAIL_CREDENTIALS_KEY_V1.project}{' '}
          {EMAIL_HOSTED_SECRET_PRESENCE.EMAIL_CREDENTIALS_KEY_V1.environments.join(
            '/',
          )}
          ; <code>{EMAIL_HOSTED_SECRET_PRESENCE.RESEND_API_KEY.name}</code> is
          set on Conversations{' '}
          {EMAIL_HOSTED_SECRET_PRESENCE.RESEND_API_KEY.environments.join('/')}.
          Neither is serving Email routes until those routes deploy under
          release auth.
        </p>
        <ul>
          <li>
            Resend API key via Connections UI · format{' '}
            <code>
              {EMAIL_CONNECTIONS_SECRET_CONTRACT.resendApiKey.format}
            </code>
          </li>
          {EMAIL_HOSTED_SECRETS.map((row) => (
            <li key={row.name}>
              <code>{row.name}</code> · {row.format} · {row.requiredFor}
              {row.requiredNow ? ' Required before a key can be stored.' : ''}
            </li>
          ))}
          <li>
            <code>
              {EMAIL_CONNECTIONS_SECRET_CONTRACT.preferenceKeyFamily}
            </code>{' '}
            · 64 hex HMAC keys for unsubscribe tokens
          </li>
          <li>
            Webhook path {EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.method}{' '}
            <code>{EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.path}</code> ·
            after-release URL{' '}
            <code>
              {EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.afterReleaseUrl}
            </code>
            . Do not create it from this screen. Signing secret format{' '}
            <code>
              {EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.secretFormat}
            </code>
            . Secret is not created yet (release-gated).
          </li>
        </ul>
        <p>
          Keep {EMAIL_FLAGS_MUST_STAY_OFF.join(', ')} unset. Env flags are not
          controlled provider evidence.
        </p>
      </details>
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
                    Live Resend/DNS for the owned outreach names is an ops
                    lane. This screen does not write Cloudflare DNS, add
                    domains in live Resend, or enable sending.
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
            {data.configured && (
              <>
                <section aria-label="Stored credential versions">
                  <h4>Stored credential versions</h4>
                  <p>
                    Current storage version:{' '}
                    {data.credentialStorage?.currentVersion ?? 'not configured'}.
                    Saved records use versions{' '}
                    {(data.credentialStorage?.storedVersions ?? []).join(', ') ||
                      'none'}
                    . Rotation re-encrypts locally and never calls Resend.
                  </p>
                  <button
                    disabled={busy || !data.credentialStorage?.currentVersion}
                    onClick={() =>
                      void lifecycle(
                        'rotate_credentials',
                        {},
                        'Stored secrets were re-encrypted with the current key version. Live sending stays off.',
                      )
                    }
                  >
                    Re-encrypt stored secrets
                  </button>
                </section>
                {data.connections.some((c) => c.state === 'checked') && (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault()
                      const form = new FormData(event.currentTarget)
                      const secretInput = event.currentTarget.elements.namedItem(
                        'webhookSecret',
                      ) as HTMLInputElement | null
                      void lifecycle(
                        'save_webhook',
                        {
                          connectionId: String(form.get('webhookConnectionId')),
                          secret: secretInput?.value ?? '',
                          endpointId: String(form.get('webhookEndpointId') || '') || undefined,
                        },
                        'Webhook signing secret saved locally and left inactive. No Resend endpoint was created.',
                      )
                      if (secretInput) secretInput.value = ''
                    }}
                  >
                    <h4>Webhook signing secret</h4>
                    <p>
                      Paste the signing secret from an existing Resend webhook.
                      New endpoints stay inactive. This does not subscribe a
                      live URL.
                    </p>
                    <label>
                      Connection
                      <select
                        name="webhookConnectionId"
                        required
                        disabled={busy}
                      >
                        {data.connections
                          .filter((c) => c.state === 'checked')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.account_label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Existing endpoint to rotate
                      <select name="webhookEndpointId" disabled={busy}>
                        <option value="">Create a new inactive endpoint</option>
                        {(data.webhooks ?? []).map((hook) => (
                          <option key={hook.id} value={hook.id}>
                            {hook.masked_secret ?? 'masked'} ·{' '}
                            {hook.active ? 'active' : 'inactive'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Webhook signing secret
                      <input
                        type="password"
                        name="webhookSecret"
                        autoComplete="off"
                        spellCheck={false}
                        required
                        maxLength={220}
                        disabled={busy}
                      />
                    </label>
                    <button disabled={busy}>Save webhook secret locally</button>
                  </form>
                )}
                {data.connections.filter((c) =>
                  ['checked', 'revoked', 'failed'].includes(c.state),
                ).length > 1 && (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault()
                      const form = new FormData(event.currentTarget)
                      void lifecycle(
                        'review_replacement',
                        {
                          connectionId: String(form.get('replacementId')),
                          replacesConnectionId: String(form.get('replacedId')),
                          confirmedAffectedHash: data.replacementReview?.hash,
                          reason: String(form.get('replacementReason') ?? ''),
                        },
                        'Replacement reviewed. Historical provider IDs were not rewritten. Sending stays off.',
                      )
                    }}
                  >
                    <h4>Historical account replacement</h4>
                    <p>
                      Review a newer checked account against an older record.
                      Domain and event history keep their original connection
                      IDs.
                    </p>
                    <label>
                      Keep this checked account
                      <select name="replacementId" required disabled={busy}>
                        {data.connections
                          .filter((c) => c.state === 'checked')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.account_label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Mark this older account as replaced
                      <select name="replacedId" required disabled={busy}>
                        {data.connections
                          .filter((c) => c.state !== 'checking')
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.account_label} · {c.state}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Replacement reason
                      <input
                        name="replacementReason"
                        required
                        maxLength={500}
                        disabled={busy}
                      />
                    </label>
                    <button disabled={busy}>Record replacement review</button>
                  </form>
                )}
              </>
            )}
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
          CRM follow-up tasks already work. Email does not book Google events.
          Stored Calendar tokens from other CRM work are not treated as a live
          Email connection; refresh and per-agent calendars still need a
          verified check.
        </p>
        <p>
          Save the weekday callback policy under More → Sending & phone.
          Automatic booking stays off.
        </p>
      </section>
      <section>
        <h4>Caller number & notifications</h4>
        <p>
          Private Email alerts are in the header. Push tests record a blocked
          attempt until a device is registered. An intended response number can
          be saved without buying or routing a live line.
        </p>
      </section>
    </div>
  )
}
