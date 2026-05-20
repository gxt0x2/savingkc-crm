'use client'

import { useCallback, useEffect, useState } from 'react'
import { captureAttribution, getAttribution } from '@/lib/ppc/attribution'
import { fireConversion } from '@/lib/ppc/conversions'
import { AddressAutocomplete } from './AddressAutocomplete'

type Situation =
  | 'tax-delinquent'
  | 'inherited'
  | 'tired-landlord'
  | 'condition'
  | 'life-event'
  | 'land'

type Timeline = 'asap' | '60-days' | 'flexible' | 'exploring'
type Condition = 'good' | 'needs-work' | 'major-repair' | 'vacant'

interface QuizState {
  situation: Situation | ''
  timeline: Timeline | ''
  condition: Condition | ''
  address: string
  name: string
  phone: string
  email: string
}

const EMPTY_STATE: QuizState = {
  situation: '',
  timeline: '',
  condition: '',
  address: '',
  name: '',
  phone: '',
  email: '',
}

const SITUATION_TILES: { value: Situation; icon: string; label: string }[] = [
  { value: 'tax-delinquent', icon: 'gavel', label: 'Behind on taxes' },
  { value: 'inherited', icon: 'family_history', label: 'Inherited it' },
  { value: 'tired-landlord', icon: 'person_off', label: 'Tired landlord' },
  { value: 'condition', icon: 'construction', label: 'Needs repairs' },
  { value: 'life-event', icon: 'schedule_send', label: 'Life event' },
  { value: 'land', icon: 'landscape', label: 'Land or lot' },
]

const TIMELINE_TILES: { value: Timeline; label: string }[] = [
  { value: 'asap', label: 'ASAP (under 30 days)' },
  { value: '60-days', label: '30–60 days' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'exploring', label: 'Just exploring' },
]

const CONDITION_TILES: { value: Condition; icon: string; label: string }[] = [
  { value: 'good', icon: 'verified', label: 'Move-in ready' },
  { value: 'needs-work', icon: 'handyman', label: 'Needs work' },
  { value: 'major-repair', icon: 'construction', label: 'Major repairs' },
  { value: 'vacant', icon: 'door_front', label: 'Vacant' },
]

export function SellLanding({ phoneDisplay, phoneTel }: { phoneDisplay: string; phoneTel: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [state, setState] = useState<QuizState>(EMPTY_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [manifestId, setManifestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quizStartedFired, setQuizStartedFired] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    captureAttribution()
  }, [])

  const postPartial = useCallback(async (currentStep: 1 | 2 | 3, partial: Partial<QuizState>) => {
    try {
      const attribution = getAttribution()
      await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: currentStep,
          ...partial,
          attribution,
        }),
      })
    } catch {
      // best-effort
    }
  }, [])

  const advance = (toStep: 1 | 2 | 3) => {
    setError(null)
    if (toStep === 2) {
      if (!state.situation) {
        setError('Pick a situation to continue.')
        return
      }
      if (!quizStartedFired) {
        fireConversion('lead_quiz_started')
        setQuizStartedFired(true)
      }
      postPartial(1, { situation: state.situation })
    }
    if (toStep === 3) {
      if (!state.timeline || !state.condition) {
        setError('Answer both questions to continue.')
        return
      }
      fireConversion('lead_quiz_qualified')
      postPartial(2, {
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
      })
    }
    setStep(toStep)
  }

  const submit = async () => {
    setError(null)
    if (!state.address.trim() || !state.name.trim() || !state.phone.trim() || !state.email.trim()) {
      setError('We need all four to send you a custom offer.')
      return
    }
    setSubmitting(true)
    try {
      const attribution = getAttribution()
      const r = await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 3,
          address: state.address,
          situation: state.situation,
          timeline: state.timeline,
          condition: state.condition,
          contact: {
            name: state.name,
            phone: state.phone,
            email: state.email,
          },
          attribution,
        }),
      })
      const json = await r.json()
      if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'Submit failed')
      fireConversion('lead_submitted')
      setManifestId(json.manifestId ?? null)
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed. Please try again or call us.')
    } finally {
      setSubmitting(false)
    }
  }

  const openCalcom = () => {
    const link = process.env.NEXT_PUBLIC_CALCOM_PPC_LINK ?? 'https://cal.com/savingkc/sell-consult'
    const url = manifestId ? `${link}?metadata[manifestId]=${manifestId}` : link
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const select = <K extends keyof QuizState>(key: K, value: QuizState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  const scrollToQuiz = () => document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth' })
  const scrollToId = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="skc-sell">
      {/* ============ TOP BAR ============ */}
      <div className="topbar">
        <div className="container topbar-inner">
          <a href="#quiz" className="logo" onClick={scrollToId('quiz')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/skc-logo.png" alt="Saving KC Homebuyers" className="topbar-logo" width={489} height={141} />
          </a>
          <nav className="nav-links" aria-label="primary">
            <a href="#how" onClick={scrollToId('how')}>How it works</a>
            <a href="#about" onClick={scrollToId('about')}>About us</a>
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews')}>Reviews</a>
          </nav>
          <div className="topbar-right">
            <div className="topbar-trust">
              <span className="stars">★★★★★</span>
              <span><strong>100+</strong> KC homeowners helped</span>
            </div>
            <a href={`tel:${phoneTel}`} className="topbar-phone">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>call</span>
              {phoneDisplay}
            </a>
            <button
              type="button"
              className="nav-toggle"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              <span className="material-symbols-outlined" aria-hidden>{mobileMenuOpen ? 'close' : 'menu'}</span>
            </button>
          </div>
        </div>
        <div className={`mobile-menu ${mobileMenuOpen ? 'open' : ''}`}>
          <div className="mobile-menu-inner">
            <a href="#how" onClick={scrollToId('how')}>How it works</a>
            <a href="#about" onClick={scrollToId('about')}>About us</a>
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews')}>Reviews</a>
            <div className="mobile-trust">
              <span className="stars">★★★★★</span>
              <span><strong>100+</strong> KC homeowners helped</span>
            </div>
            <a href={`tel:${phoneTel}`} className="mobile-phone">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>call</span>
              {phoneDisplay}
            </a>
          </div>
        </div>
      </div>

      {/* ============ HERO ============ */}
      <section className="hero" id="quiz">
        <div className="container">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="hero-eyebrow">
                <span className="dot"></span> Kansas City • MO + KS
              </div>
              <h1>Sell My House In Kansas City Today.</h1>
              <p className="sub">
                Back taxes. A house you didn&apos;t ask for. A tenant you can&apos;t get out. Repairs you stopped counting. Whatever it is, you don&apos;t have to fix it, clean it, or explain it. Tell us the address. We bring a fair cash number in an hour. You pick the day it closes.
              </p>

              <ul className="hero-bullets">
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>You pay $0.</strong> No fees, no commissions, no repairs, and no cleanup. The number we say is the check you get.
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Keep your privacy.</strong> Handle things quietly at closing. Probate, liens, back taxes, hoarder mess. No neighbors. No judgment.
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Pick your payday.</strong> Close in 14 days if you need out fast, or take 60. You set the pace.
                  </span>
                </li>
              </ul>

              <div className="hero-trust-row">
                <span className="stars">★★★★★</span>
                <span className="trust-text">
                  <strong>4.9/5</strong> from <strong>100+ KC homeowners</strong>
                </span>
                <span className="trust-text">
                  • <strong>11 years</strong> in the KC market
                </span>
              </div>
            </div>

            <div className="hero-form">
            <div className="tool-card">
              <span className="tool-eyebrow">
                <span className="material-symbols-outlined" aria-hidden>bolt</span>
                Start here
              </span>
              <h2>Get Your Cash Offer in 1 hour.</h2>
              <p className="tool-sub">
                Get a cash-offer range based on your property location, condition, and timeline in less than 1 hour.
              </p>

              <div className="step-indicator">
                <span className="step-pill" aria-label={`Step ${step} of 3`}>
                  <span className="step-num-circle">{step}</span>
                  <span className="step-num-text">Step {step} of 3</span>
                </span>
                <span className="step-track">
                  <span className="step-track-fill" style={{ width: `${(step / 3) * 100}%` }} />
                </span>
              </div>
              <div className="step-label">
                {step === 3 ? '15 seconds to finish' : step === 2 ? '20 seconds' : '30 seconds'}
              </div>

              {submitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12, color: 'var(--green)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 56, fontVariationSettings: "'FILL' 1" }} aria-hidden>
                      check_circle
                    </span>
                  </div>
                  <h3 style={{ fontSize: 22, marginBottom: 8 }}>You&apos;re in.</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 20 }}>
                    We&apos;ll text and email your cash-offer range within the hour. Lock in a quick call now and we&apos;ll walk you through it.
                  </p>
                  <button type="button" className="btn-continue" onClick={openCalcom}>
                    Book a 15-min Call
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                </div>
              ) : step === 1 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field form-field-prominent">
                    <span className="field-label">What&apos;s your situation?</span>
                    <div className="radio-group three-col">
                      {SITUATION_TILES.map(({ value, icon, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`radio-tile ${state.situation === value ? 'selected' : ''}`}
                          onClick={() => select('situation', value)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>{icon}</span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button type="button" className="btn-continue" onClick={() => advance(2)}>
                    Continue
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                  <p className="form-footer">
                    <span className="lock">
                      <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 3 }} aria-hidden>lock</span>
                    </span>
                    Your info stays private. No spam, ever.
                  </p>
                </div>
              ) : step === 2 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field">
                    <label>How soon do you need to sell?</label>
                    <div className="radio-group">
                      {TIMELINE_TILES.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`radio-tile ${state.timeline === value ? 'selected' : ''}`}
                          onClick={() => select('timeline', value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-field">
                    <label>Condition of the property</label>
                    <div className="radio-group">
                      {CONDITION_TILES.map(({ value, icon, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`radio-tile ${state.condition === value ? 'selected' : ''}`}
                          onClick={() => select('condition', value)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>{icon}</span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button type="button" className="btn-continue" onClick={() => advance(3)}>
                    See My Offer Range
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      background: 'rgba(31,193,107,0.08)',
                      border: '1px solid rgba(31,193,107,0.3)',
                      padding: '8px 12px',
                      borderRadius: 8,
                      marginBottom: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--green)',
                      fontWeight: 600,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ color: 'var(--green)', fontSize: 18, fontVariationSettings: "'FILL' 1" }} aria-hidden>
                      check_circle
                    </span>
                    Cash-offer range ready — finish below to see it.
                  </div>
                  <div className="form-field">
                    <label htmlFor="address">Property address</label>
                    <AddressAutocomplete
                      id="address"
                      placeholder="Start typing your address…"
                      value={state.address}
                      onChange={(v) => select('address', v)}
                    />
                  </div>
                  <div className="form-row-2">
                    <div className="form-field">
                      <label htmlFor="name">Your name</label>
                      <input
                        id="name"
                        type="text"
                        placeholder="First and last name"
                        autoComplete="name"
                        value={state.name}
                        onChange={(e) => select('name', e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="phone">Phone</label>
                      <input
                        id="phone"
                        type="tel"
                        placeholder="(555) 123-4567"
                        autoComplete="tel"
                        value={state.phone}
                        onChange={(e) => select('phone', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="you@email.com"
                      autoComplete="email"
                      value={state.email}
                      onChange={(e) => select('email', e.target.value)}
                    />
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button type="button" className="btn-continue" onClick={submit} disabled={submitting}>
                    {submitting ? 'Sending…' : 'Get My Custom Offer'}
                    {!submitting && (
                      <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                    )}
                  </button>
                  <p className="form-footer">
                    <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 3 }} aria-hidden>lock</span>
                    Inbound-only · We never sell your info · A2P 10DLC compliant
                  </p>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="block" id="how">
        <div className="container">
          <div className="section-eyebrow">How it works</div>
          <h2 className="section-title">Out from under it in 3 steps.</h2>
          <p className="section-sub">
            No back-and-forth, no surprise fees, no walk-throughs unless you want one. Here&apos;s what actually happens.
          </p>

          <div className="steps-grid">
            <div className="step">
              <div className="step-icon">
                <span className="material-symbols-outlined" style={{ fontSize: 30 }} aria-hidden>location_on</span>
              </div>
              <div className="step-num">Step 1 · 30 sec</div>
              <h3>Tell us about the property</h3>
              <p>
                Address, situation, timeline. That&apos;s it. No SSN, no income docs, no credit check — we&apos;re buying the house, not lending to you.
              </p>
            </div>
            <div className="step">
              <div className="step-icon">
                <span className="material-symbols-outlined" style={{ fontSize: 30 }} aria-hidden>call</span>
              </div>
              <div className="step-num">Step 2 · 1 hour</div>
              <h3>We build a structured offer</h3>
              <p>
                We pull title, check the back-tax balance, and structure an offer that <em>actually accounts for your situation</em> — probate, liens, code violations, all of it.
              </p>
            </div>
            <div className="step">
              <div className="step-icon">
                <span className="material-symbols-outlined" style={{ fontSize: 30 }} aria-hidden>key</span>
              </div>
              <div className="step-num">Step 3 · 7–30 days</div>
              <h3>You pick the closing date</h3>
              <p>
                Cash at closing through a local KC title company. We pay the back taxes, handle the paperwork, and you walk away clean. Need to stay 30 days? We work that in.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ SITUATIONS ============ */}
      <section className="block" id="about">
        <div className="container">
          <div className="section-eyebrow">Who we help</div>
          <h2 className="section-title">If life put you here, we can help.</h2>
          <p className="section-sub">
            No matter how you ended up holding this house, you&apos;re not the first and you won&apos;t be the last. We&apos;ve built the offer for every one of these — quietly, fairly, fast.
          </p>

          <div className="situations-grid">
            <SitCard icon="gavel" title="Back taxes piling up" body="Stop the auction clock and walk away with the equity you’d otherwise lose at the courthouse steps. We pay the county directly." cta="Protect what you’ve built" />
            <SitCard icon="family_history" title="Inherited more than you bargained for" body="Turn a house full of memories and obligations into one clean check your family can split. We work alongside probate — you don’t have to wait for it." cta="Honor the past, move forward" />
            <SitCard icon="person_off" title="Done being everybody’s landlord" body="Hand us the keys, the tenant, and the headache. We close with renters in place — no evictions, no awkward conversations, no 60-day notices." cta="Get your weekends back" />
            <SitCard icon="construction" title="A house you can’t afford to fix" body="Fire damage, foundation cracks, code violations, a kitchen frozen in 1978 — none of it scares us, and none of it lowers our offer the way a retail buyer would." cta="Sell it exactly as it sits" />
            <SitCard icon="schedule_send" title="Foreclosure, divorce, or a fast move" body="When life forces a fast decision, we move at your speed and protect your privacy. 14-day closings with title partners who already know our paperwork." cta="Close on your timeline" />
            <SitCard icon="landscape" title="Land or lots draining your wallet" body="Vacant lots, ag parcels, that infill piece your uncle left you — if it’s costing you taxes every year and earning you nothing, we’ll take it off your books." cta="Stop paying for nothing" />
          </div>
        </div>
      </section>

      {/* ============ MID CTA ============ */}
      <section className="block">
        <div className="container">
          <div className="mid-cta">
            <div className="mid-cta-content">
              <h2>
                Every month you wait, this gets <span className="accent">harder, not cheaper.</span>
              </h2>
              <p>
                Property problems compound. Taxes accrue interest. Vacant houses get vandalized. Estates rack up legal costs. Tenants disappear with the security deposit. The number you get six months from now will be smaller than the number you can get this week. Let&apos;s see yours.
              </p>
              <div className="mid-cta-actions">
                <a href="#quiz" className="btn-secondary" onClick={(e) => { e.preventDefault(); scrollToQuiz() }}>
                  See My Number
                  <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                </a>
                <a href={`tel:${phoneTel}`} className="btn-secondary">
                  <span className="material-symbols-outlined" aria-hidden>call</span>
                  Call {phoneDisplay}
                </a>
              </div>
            </div>
            <div className="mid-cta-stat">
              <div className="stat-box">
                <div className="num">$45K</div>
                <div className="label">Average cash in homeowners&apos; pockets at closing</div>
              </div>
              <div className="stat-box">
                <div className="num">18 days</div>
                <div className="label">Fastest close when you need out now</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ COUNTIES ============ */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">Service area</div>
          <h2 className="section-title">We know your county. And your block.</h2>
          <p className="section-sub">
            We work both sides of the state line. If your property is in any of these counties, we can help.
          </p>

          <div className="county-grid">
            {[
              ['JA', 'Jackson County', 'Missouri'],
              ['CL', 'Clay County', 'Missouri'],
              ['PL', 'Platte County', 'Missouri'],
              ['WY', 'Wyandotte County', 'Kansas'],
              ['JO', 'Johnson County', 'Kansas'],
              ['+', 'Surrounding metro', 'Case-by-case'],
            ].map(([flag, name, sub]) => (
              <div key={name} className="county-card">
                <div className="county-flag">{flag}</div>
                <div>
                  <h4>{name}</h4>
                  <div className="state">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TESTIMONIALS ============ */}
      <section className="block" id="reviews">
        <div className="container">
          <div className="section-eyebrow">What KC homeowners say</div>
          <h2 className="section-title">100+ neighbors. Real stories.</h2>
          <p className="section-sub">
            These aren&apos;t paid testimonials. They&apos;re people we&apos;ve actually helped — and you can ask them yourself before we close.
          </p>

          <div className="testimonials">
            <Testimonial
              initials="RM"
              name="Renee M."
              meta="Inherited property · Jackson County, MO"
              quote='"Three years of unpaid taxes on a house I inherited from my dad. Every other buyer wanted to deduct the taxes twice from the offer. Saving KC paid the back taxes at closing and still gave me a fair number. Closed in 18 days."'
            />
            <Testimonial
              initials="DT"
              name="David T."
              meta="Tired landlord · Wyandotte County, KS"
              quote='"Bad tenants, busted HVAC, and I live in Denver. I didn’t have the time or the heart to deal with it. Ernest’s team handled the tenant conversation, took the property as-is with everything still inside. Done."'
            />
            <Testimonial
              initials="JK"
              name="Jerome K."
              meta="Pre-DLT auction · Jackson County, MO"
              quote='"I was 60 days from the DLT auction. Two other ‘we buy houses’ guys ghosted me when they saw the title. Saving KC didn’t blink — closed in 14 days. I walked away with money instead of a court notice."'
            />
            <Testimonial
              initials="SP"
              name="Sandra P."
              meta="Probate sale · Clay County, MO"
              quote='"My brother and I disagreed on everything about the estate. They worked with both of us, kept the communication separate when we needed it, and got us to closing without making it worse. That’s rare."'
            />
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="block" id="faq">
        <div className="container">
          <div className="section-eyebrow">Common questions</div>
          <h2 className="section-title">Questions worth asking.</h2>

          <div className="faq-list">
            {FAQS.map((faq, i) => (
              <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q} <span className="plus">+</span>
                </button>
                <div className="faq-a">
                  <p>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="block">
        <div className="container">
          <div className="final-cta">
            <h2>
              Stop wondering.{' '}
              <span className="accent">Find out what your house is actually worth in 30 seconds.</span>
            </h2>
            <p>
              No phone call until you ask. No pressure, no spam. Just a real offer range based on your address and your situation.
            </p>
            <a
              href="#quiz"
              className="btn-secondary lg"
              onClick={(e) => {
                e.preventDefault()
                scrollToQuiz()
              }}
            >
              Get My Free Offer Estimate
              <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
            </a>
            <div className="micro">
              Or call us directly at{' '}
              <a href={`tel:${phoneTel}`} style={{ color: 'var(--text)' }}>
                {phoneDisplay}
              </a>{' '}
              · Mon–Sat, 8am–8pm CT
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            © 2026 Saving KC Homebuyers LLC · Kansas City, MO · We are not a licensed real estate brokerage. We buy properties as principal investors.
          </div>
          <div className="footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href={`tel:${phoneTel}`}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SitCard({ icon, title, body, cta }: { icon: string; title: string; body: string; cta: string }) {
  return (
    <a href="#quiz" className="sit-card">
      <div className="sit-icon">
        <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="sit-link">{cta}</span>
    </a>
  )
}

function Testimonial({
  initials,
  name,
  meta,
  quote,
}: {
  initials: string
  name: string
  meta: string
  quote: string
}) {
  return (
    <div className="testimonial">
      <div className="stars">★★★★★</div>
      <p className="testimonial-quote">{quote}</p>
      <div className="testimonial-author">
        <div className="author-avatar">{initials}</div>
        <div>
          <div className="author-name">{name}</div>
          <div className="author-meta">{meta}</div>
        </div>
      </div>
    </div>
  )
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How much will I actually get?',
    a: "Depends on the property's after-repair value, condition, and any liens or back taxes. Our offers typically come in 65–85% of after-repair value, minus repairs and back taxes. We show you the math — no black-box numbers. If our offer doesn't make sense for you, we'll tell you that too.",
  },
  {
    q: 'Do I need to pay the back taxes before selling?',
    a: "No. We pay them directly to the county at closing out of the sale proceeds. You don't write a check — it comes off the top of our offer, and you see exactly how it's calculated.",
  },
  {
    q: 'Can you buy if the house is still in probate?',
    a: "Yes, in most cases. We've closed deals where probate was still open — we just structure the timing around the court's process. We work with KC probate attorneys regularly and can refer you to one if you don't have one.",
  },
  {
    q: 'What if there are tenants in the property?',
    a: "We buy with tenants in place. You don't have to evict, give notice, or have an awkward conversation. We take the lease as-is at closing.",
  },
  {
    q: 'Are there any fees or commissions?',
    a: 'None. No agent commissions, no closing costs on your end, no inspection fees. The number on our offer is what hits your bank account (minus payoffs and back taxes, which we disclose line-by-line).',
  },
  {
    q: 'How fast can you close?',
    a: "Fastest we've done is 18 days from offer to close on a pre-DLT property. Typical is 21–30 days, but we'll close on your timeline — including if you need 60–90 days to find your next place.",
  },
  {
    q: 'Why should I trust Saving KC over the other "cash for houses" guys?',
    a: "Fair question. Three things: (1) We're a real KC business with 11 years here, not a national lead-buyer reselling your info. (2) We close most of what we put under contract — we don't tie up your property and back out. (3) We'll give you references to homeowners we've closed with in the last 90 days. Call them before you sign anything.",
  },
]
