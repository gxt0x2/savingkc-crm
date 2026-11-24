'use client'

import { useState, type FormEvent } from 'react'
import {
  NEWSLETTER_BRAND,
  NEWSLETTER_COMPANY_PHONE,
  NEWSLETTER_CONSENT_TEXT,
  NEWSLETTER_COUNTIES,
  NEWSLETTER_LICENSE_LINE,
  NEWSLETTER_SIGNUP_SUCCESS,
} from '@/lib/email/newsletters/constants'

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'done' } | { kind: 'error'; message: string }

export function NewsletterSignup({ source = 'funnel' }: { source?: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'seller' | 'buyer' | ''>('')
  const [county, setCounty] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'saving' })
    try {
      const response = await fetch('/api/email/newsletters/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, county, consent, source }),
      })
      const body = (await response.json()) as { ok?: boolean; error?: string; message?: string }
      if (!response.ok || !body.ok) {
        setStatus({ kind: 'error', message: body.error || 'Signup is not available yet. Nothing was saved.' })
        return
      }
      setStatus({ kind: 'done' })
    } catch {
      setStatus({ kind: 'error', message: 'Signup is not available yet. Nothing was saved.' })
    }
  }

  return (
    <section id="tuesday-newsletter" aria-label="Tuesday newsletter signup" style={{ background: '#ffffff', color: '#111111' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 18px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#71717a' }}>{NEWSLETTER_BRAND}</p>
        <h2 style={{ margin: '8px 0', fontSize: 28, lineHeight: 1.2 }}>The Tuesday newsletters</h2>
        <p style={{ margin: '0 0 18px', fontSize: 16, lineHeight: 1.5 }}>
          One short note each Tuesday from Ernest. Sellers get The Tuesday Note. Buyers and investors get The Tuesday Deal Desk.
        </p>
        <form onSubmit={onSubmit} style={{ border: '1px solid #d4d4d8', borderRadius: 8, padding: 16 }}>
          <label htmlFor={`${source}-newsletter-email`} style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Email</label>
          <input
            id={`${source}-newsletter-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d4d4d8', borderRadius: 6, padding: 10, font: 'inherit' }}
          />
          <fieldset style={{ border: 0, padding: '12px 0 0', margin: 0 }}>
            <legend style={{ fontSize: 14, fontWeight: 700 }}>I am a</legend>
            <label style={{ display: 'block', marginTop: 8 }}>
              <input type="radio" name="role" value="seller" checked={role === 'seller'} onChange={() => setRole('seller')} required /> Seller
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              <input type="radio" name="role" value="buyer" checked={role === 'buyer'} onChange={() => setRole('buyer')} /> Buyer or investor
            </label>
          </fieldset>
          <label htmlFor={`${source}-newsletter-county`} style={{ display: 'block', fontSize: 14, fontWeight: 700, margin: '12px 0 6px' }}>County</label>
          <select
            id={`${source}-newsletter-county`}
            name="county"
            required
            value={county}
            onChange={(event) => setCounty(event.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d4d4d8', borderRadius: 6, padding: 10, font: 'inherit' }}
          >
            <option value="">Choose a county</option>
            {NEWSLETTER_COUNTIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <label style={{ display: 'block', marginTop: 14, fontSize: 14, lineHeight: 1.4 }}>
            <input type="checkbox" name="consent" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /> {NEWSLETTER_CONSENT_TEXT}
          </label>
          <button
            type="submit"
            disabled={status.kind === 'saving'}
            style={{ marginTop: 16, background: '#C8102E', color: '#ffffff', border: 0, borderRadius: 6, padding: '10px 14px', fontFamily: 'inherit', fontWeight: 700 }}
          >
            {status.kind === 'saving' ? 'Saving' : 'Send me the Tuesday note'}
          </button>
          {status.kind === 'error' ? <p role="alert" style={{ color: '#C8102E' }}>{status.message}</p> : null}
          {status.kind === 'done' ? <p role="status">{NEWSLETTER_SIGNUP_SUCCESS}</p> : null}
        </form>
        <p style={{ margin: '16px 0 0', fontSize: 12, lineHeight: 1.5, color: '#71717a' }}>
          {NEWSLETTER_LICENSE_LINE} Company phone {NEWSLETTER_COMPANY_PHONE}.
        </p>
      </div>
    </section>
  )
}
