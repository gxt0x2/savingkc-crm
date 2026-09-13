'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import {
  INTENDED_OUTREACH_DOMAINS,
  PRIMARY_BUSINESS_DOMAIN,
  intendedOutreachReadiness,
} from '@/lib/email/domains/intended'
import styles from './email-workspace.module.css'
type Domain = {
  id: string
  name: string
  state: string
  connection_state: string
  sending_state: string
  receiving_state: string
  paused: boolean
  revision: number
  brand_url: string
  failure_code: string | null
  dns_records: {
    record: string
    name: string
    type: string
    value: string
    status: string
    priority?: number
  }[]
}
type Sender = {
  id: string
  domain_id: string
  from_name: string
  local_part: string
  signature: string
  hourly_limit: number
  daily_limit: number
  state: 'paused' | 'active' | 'retired'
  revision: number
}
type State = {
  configured: boolean
  revision: number
  primaryDomain: string | null
  connections: { id: string; account_label: string }[]
  domains: Domain[]
  senders: Sender[]
}
const errors: Record<string, string> = {
  DOMAIN_CREATE_UNCERTAIN:
    'Resend did not confirm the result. Check provider status before adding this domain again.',
  DOMAIN_NOT_FOUND_AT_PROVIDER:
    'No matching domain was found. Review the domain in Resend, then check again.',
  DOMAIN_REVIEW_CHANGED:
    'Connection or business settings changed during the check. Review them, then check again.',
  BUSINESS_DOMAIN_CHANGED:
    'The main company domain changed. Confirm this outreach domain is still independent, then check again.',
  DOMAIN_RESPONSE_MISMATCH:
    'The provider returned a different domain. Review the provider account before continuing.',

  PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN:
    'Use a separately registered outreach domain. The main company domain and its subdomains are blocked.',
  INVALID_EMAIL_DOMAIN:
    'Enter a domain name only, such as talktosavingkc.com.',
  BUSINESS_SETUP_REQUIRED: 'Save the main company domain in Business first.',
  HTTPS_BRAND_URL_REQUIRED: 'Use an HTTPS brand-page URL.',
  BRAND_DOMAIN_MISMATCH: 'The brand page must live on this outreach domain.',
  CREDENTIAL_STORAGE_REQUIRED:
    'Connect Resend in a secured workspace before setting up domains.',
  CREDENTIAL_DECRYPT_FAILED:
    'The saved credential could not be opened. An owner needs to check secure storage.',
  DOMAIN_CONNECTION_REQUIRED: 'Connect and check Resend first.',
  DOMAIN_EXISTS_REVIEW:
    'This domain already has a different connection or brand page. Review the existing record.',
  DOMAIN_CHECK_RUNNING:
    'Domain setup is still running. Refresh before checking again.',
  REVISION_CONFLICT:
    'This record changed. Refresh and review it before saving.',
  SENDER_TEST_REQUIRED:
    'Sender activation requires delivery and reply checks. Save it paused for now.',
  SENDER_IDENTITY_IN_USE:
    'This sender is attached to a conversation. Keep its name, address and domain unchanged.',
  SENDER_RETIRED:
    'A retired sender stays retired to preserve existing conversations.',
  SENDER_ADDRESS_EXISTS: 'That sender address already exists on this domain.',
  INVALID_SENDER_NAME: 'Use a single-line sender name.',
  INVALID_SENDER_ADDRESS:
    'Use a lowercase address without leading, trailing or consecutive dots.',
  INVALID_SENDER_LIMITS: 'The daily limit must be at least the hourly limit.',
}
export function EmailDomains() {
  const [data, setData] = useState<State | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Sender | null>(null)
  const counter = useRef(0)
  async function refresh() {
    const sequence = ++counter.current
    try {
      const response = await fetch('/api/email/domains', { cache: 'no-store' })
      const body = await response.json()
      if (sequence !== counter.current) return
      if (!response.ok) throw Error('unavailable')
      setData(body)
    } catch {
      if (sequence === counter.current)
        setNotice('Sender setup could not be loaded. Refresh to retry.')
    }
  }
  useEffect(() => {
    void refresh()
    const pending = counter
    return () => {
      pending.current++
    }
  }, [])
  async function act(command: EmailCommand) {
    if (busy) return
    setBusy(true)
    setNotice('Saving…')
    const sequence = ++counter.current
    try {
      const response = await fetch('/api/email/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const body = await response.json()
      if (sequence !== counter.current) return
      if (!response.ok) {
        setNotice(
          errors[body.error?.code] ??
            'This action could not finish. Refresh and review the current setup.',
        )
        return
      }
      setData(body)
      const domain = body.domains.find((d: Domain) => d.id === body.entityId)
      setNotice(
        domain?.state === 'uncertain'
          ? 'The provider result needs reconciliation. Use Check provider status; do not add the domain again.'
          : domain?.state === 'held'
            ? 'Setup changed during the check. Review the connection and business domain before continuing.'
            : 'Saved. Sending remains paused until launch checks pass.',
      )
      setEditing(null)
    } catch {
      if (sequence === counter.current)
        setNotice('The result is unknown. Refresh before trying again.')
    } finally {
      setBusy(false)
    }
  }
  function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    const f = new FormData(event.currentTarget)
    void act({
      command: 'DOM-ADD',
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: data.revision,
      payload: {
        domain: String(f.get('domain')),
        connectionId: String(f.get('connection')),
        brandUrl: String(f.get('brandUrl')),
      },
    })
  }
  function saveSender(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    const f = new FormData(event.currentTarget)
    void act({
      command: 'SND-SAVE',
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: editing?.revision ?? data.revision,
      payload: {
        ...(editing ? { senderId: editing.id } : {}),
        domainId: String(f.get('domainId')),
        fromName: String(f.get('fromName')),
        localPart: String(f.get('localPart')),
        signature: String(f.get('signature')),
        hourlyLimit: Number(f.get('hourlyLimit')),
        dailyLimit: Number(f.get('dailyLimit')),
        state: f.get('state') === 'retired' ? 'retired' : 'paused',
      },
    })
  }
  const enabled =
    !!data?.configured && !!data?.primaryDomain && !!data?.connections.length
  return (
    <section className={styles.form} aria-label="Sender domains">
      <div className={styles.row}>
        <h4>Sender domains</h4>
        <button onClick={refresh} disabled={busy}>
          Refresh sender setup
        </button>
      </div>
      <p>
        Use a separately registered domain. Main company domain:{' '}
        <strong>{data?.primaryDomain ?? 'Save it in Business first'}</strong>.{' '}
        {PRIMARY_BUSINESS_DOMAIN} is excluded from campaign senders.
      </p>
      <ul aria-label="Intended outreach domains">
        {INTENDED_OUTREACH_DOMAINS.map((domain) => {
          const readiness = intendedOutreachReadiness(domain)
          return (
            <li key={domain.name}>
              <strong>{domain.name}</strong> — registrar owned, nameservers on
              Cloudflare. Email DNS {readiness.dnsReady ? 'ready' : 'not ready'}
              ; Resend {readiness.resendReady ? 'added' : 'not added'}; sending{' '}
              {readiness.sendingReady ? 'ready' : 'off'}.
            </li>
          )
        })}
      </ul>
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>Loading sender setup…</p>
      ) : (
        <>
          {!enabled && (
            <p>
              Save Business details and connect Resend before adding an owned
              outreach domain.
            </p>
          )}
          <details>
            <summary>Add an owned domain</summary>
            <form onSubmit={addDomain} className={styles.form}>
              <label>
                Resend connection
                <select name="connection" required disabled={!enabled || busy}>
                  {data.connections.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.account_label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Owned outreach domain
                <input
                  name="domain"
                  required
                  maxLength={253}
                  placeholder="talktosavingkc.com"
                  disabled={!enabled || busy}
                />
              </label>
              <label>
                Brand page on this domain
                <input
                  name="brandUrl"
                  required
                  type="url"
                  placeholder="https://talktosavingkc.com"
                  disabled={!enabled || busy}
                />
              </label>
              <label className={styles.checkboxLine}>
                <input type="checkbox" required disabled={!enabled || busy} /> I
                own this domain and want to set up sending and receiving in
                Resend.
              </label>
              <p>
                This creates or reconciles a local domain record only when a
                checked practice connection exists. It does not write Cloudflare
                DNS, add a live Resend domain, or send mail.
              </p>
              <button className={styles.primary} disabled={!enabled || busy}>
                Set up owned domain
              </button>
            </form>
          </details>
          {data.domains.map((d) => (
            <article key={d.id} className={styles.agendaItem}>
              <strong>{d.name}</strong>
              <p>
                {d.state === 'provider_verified'
                  ? 'Provider verified · Launch checks pending'
                  : d.state === 'needs_dns'
                    ? 'DNS setup needed'
                    : d.state === 'creating'
                      ? 'Setup started'
                      : d.state === 'held'
                        ? 'Needs review'
                        : 'Provider result needs checking'}{' '}
                · Sending paused
              </p>
              <p>
                Sending capability: {d.sending_state}. Receiving capability:{' '}
                {d.receiving_state}.
              </p>
              {d.connection_state !== 'checked' && (
                <p>
                  Reconnect this provider account before checking the domain.
                </p>
              )}
              <button
                disabled={
                  busy || !data.configured || d.connection_state !== 'checked'
                }
                onClick={() =>
                  act({
                    command: 'DOM-VERIFY',
                    idempotencyKey: crypto.randomUUID(),
                    expectedRevision: d.revision,
                    payload: { domainId: d.id },
                  })
                }
              >
                Check provider status
              </button>
              <details>
                <summary>DNS & next steps</summary>
                <p>
                  Add the exact provider records at your domain registrar.
                  Existing-domain receiving settings may need enabling in
                  Resend. Brand hosting and authenticated reply routing still
                  need verification.
                </p>
                <a href={d.brand_url} target="_blank" rel="noopener noreferrer">
                  Open brand page
                </a>
                <p>Saved DNS records:</p>
                {d.dns_records.length ? (
                  d.dns_records.map((r, i) => (
                    <div
                      key={i}
                      style={{ overflowWrap: 'anywhere', marginBottom: 12 }}
                    >
                      <strong>
                        {r.record} · {r.type} · {r.status}
                      </strong>
                      <p>
                        {r.name}
                        {r.priority != null ? ` · Priority ${r.priority}` : ''}
                      </p>
                      <code>{r.value}</code>
                    </div>
                  ))
                ) : (
                  <p>
                    No DNS records returned yet. Check the provider status
                    before making DNS changes.
                  </p>
                )}
              </details>
            </article>
          ))}
          <details open={!!editing}>
            <summary>{editing ? 'Edit sender' : 'Add sender'}</summary>
            <form
              key={editing?.id ?? 'new'}
              onSubmit={saveSender}
              className={styles.form}
            >
              <label>
                Sender domain
                <select
                  name="domainId"
                  required
                  defaultValue={editing?.domain_id}
                  disabled={!data.domains.length || busy}
                >
                  {data.domains.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sender name
                <input
                  name="fromName"
                  required
                  maxLength={200}
                  defaultValue={editing?.from_name ?? 'SavingKC'}
                  disabled={busy}
                />
              </label>
              <label>
                Address before @
                <input
                  name="localPart"
                  required
                  maxLength={64}
                  defaultValue={editing?.local_part ?? 'hello'}
                  disabled={busy}
                />
              </label>
              <label>
                Signature
                <textarea
                  name="signature"
                  maxLength={2000}
                  defaultValue={editing?.signature ?? ''}
                  disabled={busy}
                />
              </label>
              <div className={styles.setupGrid}>
                <label>
                  Hourly limit
                  <input
                    name="hourlyLimit"
                    type="number"
                    required
                    min={1}
                    defaultValue={editing?.hourly_limit ?? 5}
                    disabled={busy}
                  />
                </label>
                <label>
                  Daily limit
                  <input
                    name="dailyLimit"
                    type="number"
                    required
                    min={1}
                    defaultValue={editing?.daily_limit ?? 20}
                    disabled={busy}
                  />
                </label>
                <label>
                  Sender state
                  <select
                    name="state"
                    defaultValue={
                      editing?.state === 'retired' ? 'retired' : 'paused'
                    }
                    disabled={busy}
                  >
                    <option value="paused">Paused</option>
                    <option value="retired">Retired</option>
                  </select>
                </label>
              </div>
              <p>
                Activation requires a controlled delivery and reply test.
                Retiring a sender keeps its identity attached to existing
                conversations.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={busy || !data.configured || !data.domains.length}
                >
                  Save sender
                </button>
                {editing && (
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </details>
          {data.senders.map((s) => (
            <div key={s.id} className={styles.agendaItem}>
              <strong>{s.from_name}</strong>
              <p>
                {s.local_part}@
                {data.domains.find((d) => d.id === s.domain_id)?.name ??
                  'Saved domain'}{' '}
                · {s.state}
              </p>
              <button onClick={() => setEditing(s)} disabled={busy}>
                Edit sender
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
