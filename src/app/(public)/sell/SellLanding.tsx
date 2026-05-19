'use client'

import { useCallback, useEffect, useState } from 'react'
import { captureAttribution, getAttribution } from '@/lib/ppc/attribution'
import { fireConversion } from '@/lib/ppc/conversions'

type Situation = 'tax-delinquent' | 'inherited' | 'tired-landlord' | 'other'
type Timeline = 'asap' | '60-days' | 'flexible' | 'exploring'
type Condition = 'good' | 'needs-work' | 'major-repair' | 'vacant'

interface QuizState {
  address: string
  situation: Situation | ''
  timeline: Timeline | ''
  condition: Condition | ''
  name: string
  phone: string
  email: string
}

const EMPTY_STATE: QuizState = {
  address: '',
  situation: '',
  timeline: '',
  condition: '',
  name: '',
  phone: '',
  email: '',
}

export function SellLanding({ phoneDisplay, phoneTel }: { phoneDisplay: string; phoneTel: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [state, setState] = useState<QuizState>(EMPTY_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [manifestId, setManifestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quizStartedFired, setQuizStartedFired] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  useEffect(() => {
    captureAttribution()
  }, [])

  const postPartial = useCallback(
    async (currentStep: 1 | 2 | 3, partial: Partial<QuizState>) => {
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
        // partial saves are best-effort; never block the user
      }
    },
    [],
  )

  const advance = (toStep: 1 | 2 | 3) => {
    setError(null)

    if (toStep === 2) {
      if (!state.address.trim() || !state.situation) {
        setError('Please enter your address and pick a situation.')
        return
      }
      if (!quizStartedFired) {
        fireConversion('lead_quiz_started')
        setQuizStartedFired(true)
      }
      postPartial(1, {
        address: state.address,
        situation: state.situation,
      })
    }

    if (toStep === 3) {
      if (!state.timeline || !state.condition) {
        setError('Please answer both questions to continue.')
        return
      }
      fireConversion('lead_quiz_qualified')
      postPartial(2, {
        address: state.address,
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
      })
    }

    setStep(toStep)
  }

  const submit = async () => {
    setError(null)
    if (!state.name.trim() || !state.phone.trim() || !state.email.trim()) {
      setError('We need all three to send you a custom offer.')
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
      if (!r.ok || !json?.ok) {
        throw new Error(json?.error ?? 'Submit failed')
      }
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
    const link =
      process.env.NEXT_PUBLIC_CALCOM_PPC_LINK ?? 'https://cal.com/savingkc/sell-consult'
    const url = manifestId ? `${link}?metadata[manifestId]=${manifestId}` : link
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const select = <K extends keyof QuizState>(key: K, value: QuizState[K]) =>
    setState((s) => ({ ...s, [key]: value }))

  return (
    <div className="skc-sell">
      {/* ============ TOP BAR ============ */}
      <div className="topbar">
        <div className="container topbar-inner">
          <div className="logo">
            <div className="logo-mark">SK</div>
            <span>Saving KC Homebuyers</span>
          </div>
          <div className="topbar-right">
            <div className="topbar-trust">
              <span className="stars">★★★★★</span>
              <span>
                <strong>100+</strong> KC homeowners helped
              </span>
            </div>
            <a href={`tel:${phoneTel}`} className="topbar-phone">
              📞 {phoneDisplay}
            </a>
          </div>
        </div>
      </div>

      {/* ============ HERO ============ */}
      <section className="hero" id="quiz">
        <div className="container">
          <div className="hero-grid">
            <div>
              <div className="hero-eyebrow">
                <span className="dot"></span> Kansas City • MO + KS
              </div>
              <h1>
                Sell the house. Skip the stress.{' '}
                <span className="accent">Walk away with cash in 14 days.</span>
              </h1>
              <p className="sub">
                Whatever made this house too much to handle — back taxes, probate, a divorce, a tenant nightmare, repairs you can&apos;t face — we&apos;ve seen it, we&apos;ve closed it, and we won&apos;t make you feel bad about it. One conversation, one fair offer, and you&apos;re free.
              </p>

              <ul className="hero-bullets">
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Keep your money.</strong> Zero fees, zero commissions, zero cleanup. The number we say is the check you get.
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Keep your dignity.</strong> Probate, liens, back taxes, hoarder mess — handled quietly at closing. No judgment.
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Keep your timeline.</strong> Close in 14 days if you need out fast, or take 60. You set the pace.
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

            <div className="tool-card">
              <div className="tool-badge">🎯 Free Tool · No phone required</div>
              <h2>What&apos;s your property actually worth?</h2>
              <p className="tool-sub">
                Get an instant estimated cash-offer range based on your address and situation. No obligation, no calls until you ask.
              </p>

              <div className="step-indicator">
                <div className={`step-dot ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}></div>
                <div className={`step-dot ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}></div>
                <div className={`step-dot ${step === 3 ? 'active' : ''}`}></div>
              </div>
              <div className="step-label">
                Step {step} of 3 · {step === 3 ? '15 seconds to finish' : step === 2 ? '20 seconds' : '30 seconds'}
              </div>

              {submitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
                  <h3 style={{ fontSize: 20, marginBottom: 8 }}>You&apos;re in.</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 20 }}>
                    We&apos;ll text and email your custom offer within 24 hours. Want to lock in a call now?
                  </p>
                  <button className="btn-primary lg" onClick={openCalcom}>
                    Book a 15-min Call →
                  </button>
                </div>
              ) : step === 1 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field">
                    <label htmlFor="address">Property address</label>
                    <input
                      id="address"
                      type="text"
                      placeholder="123 Main St, Kansas City, MO"
                      autoComplete="street-address"
                      value={state.address}
                      onChange={(e) => select('address', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>What&apos;s the situation?</label>
                    <div className="radio-group">
                      {(
                        [
                          ['tax-delinquent', '🏛️ Behind on taxes'],
                          ['inherited', '🏠 Inherited it'],
                          ['tired-landlord', '😮‍💨 Tired landlord'],
                          ['other', '❓ Something else'],
                        ] as [Situation, string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          className={`radio-tile ${state.situation === val ? 'selected' : ''}`}
                          onClick={() => select('situation', val)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button className="btn-primary lg" onClick={() => advance(2)}>
                    Continue →
                  </button>
                  <p className="form-footer">
                    <span className="lock">🔒</span> Your info stays private. No spam, ever.
                  </p>
                </div>
              ) : step === 2 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field">
                    <label>How soon do you need to sell?</label>
                    <div className="radio-group">
                      {(
                        [
                          ['asap', '⚡ ASAP (under 30 days)'],
                          ['60-days', '📅 30–60 days'],
                          ['flexible', '🕰️ Flexible'],
                          ['exploring', '👀 Just exploring'],
                        ] as [Timeline, string][]
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          className={`radio-tile ${state.timeline === val ? 'selected' : ''}`}
                          onClick={() => select('timeline', val)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor="condition">Condition of the property</label>
                    <select
                      id="condition"
                      value={state.condition}
                      onChange={(e) => select('condition', e.target.value as Condition)}
                    >
                      <option value="">Choose one…</option>
                      <option value="good">Move-in ready / good shape</option>
                      <option value="needs-work">Needs cosmetic work</option>
                      <option value="major-repair">Major repairs / structural issues</option>
                      <option value="vacant">Vacant / boarded up</option>
                    </select>
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button className="btn-primary lg" onClick={() => advance(3)}>
                    See My Offer Range →
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 18 }}>
                  <div
                    style={{
                      background: 'rgba(31,193,107,0.08)',
                      border: '1px solid rgba(31,193,107,0.3)',
                      padding: 14,
                      borderRadius: 10,
                      marginBottom: 18,
                    }}
                  >
                    <div style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>
                      ✓ Estimated cash-offer range ready
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Enter your contact info to see the range and lock in a 24-hour custom offer.
                    </div>
                  </div>
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
                    <label htmlFor="phone">Phone (for the custom offer)</label>
                    <input
                      id="phone"
                      type="tel"
                      placeholder={phoneDisplay}
                      autoComplete="tel"
                      value={state.phone}
                      onChange={(e) => select('phone', e.target.value)}
                    />
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
                  <button className="btn-primary lg" onClick={submit} disabled={submitting}>
                    {submitting ? 'Sending…' : 'Get My Custom Offer →'}
                  </button>
                  <p className="form-footer">
                    <span className="lock">🔒</span> Inbound-only · We never sell your info · A2P 10DLC compliant
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">How it works</div>
          <h2 className="section-title">Out from under it in 3 steps.</h2>
          <p className="section-sub">
            No back-and-forth, no surprise fees, no walk-throughs unless you want one. Here&apos;s what actually happens.
          </p>

          <div className="steps-grid">
            <div className="step">
              <div className="step-icon">📍</div>
              <div className="step-num">Step 1 · 30 sec</div>
              <h3>Tell us about the property</h3>
              <p>
                Address, situation, timeline. That&apos;s it. No SSN, no income docs, no credit check — we&apos;re buying the house, not lending to you.
              </p>
            </div>
            <div className="step">
              <div className="step-icon">📞</div>
              <div className="step-num">Step 2 · 24 hours</div>
              <h3>We build a structured offer</h3>
              <p>
                We pull title, check the back-tax balance, and structure an offer that <em>actually accounts for your situation</em> — probate, liens, code violations, all of it.
              </p>
            </div>
            <div className="step">
              <div className="step-icon">🔑</div>
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
      <section className="block">
        <div className="container">
          <div className="section-eyebrow">Who we help</div>
          <h2 className="section-title">If life put you here, we can help.</h2>
          <p className="section-sub">
            No matter how you ended up holding this house, you&apos;re not the first and you won&apos;t be the last. We&apos;ve built the offer for every one of these — quietly, fairly, fast.
          </p>

          <div className="situations-grid">
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">🏛️</div>
              <h3>Back taxes piling up</h3>
              <p>
                Stop the auction clock and walk away with the equity you&apos;d otherwise lose at the courthouse steps. We pay the county directly.
              </p>
              <span className="sit-link">Protect what you&apos;ve built</span>
            </a>
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">⚱️</div>
              <h3>Inherited more than you bargained for</h3>
              <p>
                Turn a house full of memories and obligations into one clean check your family can split. We work alongside probate — you don&apos;t have to wait for it.
              </p>
              <span className="sit-link">Honor the past, move forward</span>
            </a>
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">😮‍💨</div>
              <h3>Done being everybody&apos;s landlord</h3>
              <p>
                Hand us the keys, the tenant, and the headache. We close with renters in place — no evictions, no awkward conversations, no 60-day notices.
              </p>
              <span className="sit-link">Get your weekends back</span>
            </a>
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">🛠️</div>
              <h3>A house you can&apos;t afford to fix</h3>
              <p>
                Fire damage, foundation cracks, code violations, a kitchen frozen in 1978 — none of it scares us, and none of it lowers our offer the way a retail buyer would.
              </p>
              <span className="sit-link">Sell it exactly as it sits</span>
            </a>
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">⚖️</div>
              <h3>Foreclosure, divorce, or a fast move</h3>
              <p>
                When life forces a fast decision, we move at your speed and protect your privacy. 14-day closings with title partners who already know our paperwork.
              </p>
              <span className="sit-link">Close on your timeline</span>
            </a>
            <a href="#quiz" className="sit-card">
              <div className="sit-icon">🌾</div>
              <h3>Land or lots draining your wallet</h3>
              <p>
                Vacant lots, ag parcels, that infill piece your uncle left you — if it&apos;s costing you taxes every year and earning you nothing, we&apos;ll take it off your books.
              </p>
              <span className="sit-link">Stop paying for nothing</span>
            </a>
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
                <a href="#quiz" className="btn-primary" style={{ width: 'auto', padding: '15px 28px' }}>
                  See My Number →
                </a>
                <a href={`tel:${phoneTel}`} className="btn-secondary">
                  📞 Call {phoneDisplay}
                </a>
              </div>
            </div>
            <div className="mid-cta-stat">
              <div className="stat-box">
                <div className="num">$45K</div>
                <div className="label">Average cash in homeowners&apos; pockets at closing</div>
              </div>
              <div className="stat-box">
                <div className="num">14 days</div>
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
      <section className="block">
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
      <section className="block">
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
              className="btn-primary lg"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Get My Free Offer Estimate →
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
    a: "Fastest we've done is 14 days from offer to close on a pre-DLT property. Typical is 21–30 days, but we'll close on your timeline — including if you need 60–90 days to find your next place.",
  },
  {
    q: 'Why should I trust Saving KC over the other "cash for houses" guys?',
    a: "Fair question. Three things: (1) We're a real KC business with 11 years here, not a national lead-buyer reselling your info. (2) We close most of what we put under contract — we don't tie up your property and back out. (3) We'll give you references to homeowners we've closed with in the last 90 days. Call them before you sign anything.",
  },
]
