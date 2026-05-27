'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureAttribution, getAttribution } from '@/lib/ppc/attribution'
import { fireConversion, fireFormError, firePpcTrackingEvent } from '@/lib/ppc/conversions'
import { AddressAutocomplete } from './AddressAutocomplete'

type Situation =
  | 'tax-delinquent'
  | 'inherited'
  | 'tired-landlord'
  | 'condition'
  | 'life-event'
  | 'other'

type Timeline = 'asap' | '60-days' | 'flexible' | 'exploring'
type Condition = 'good' | 'needs-work' | 'major-repair' | 'vacant'
type AuctionStatus = 'yes' | 'no' | 'not-sure'
type FormStep = 1 | 2 | 3 | 4

interface QuizState {
  situation: Situation | ''
  timeline: Timeline | ''
  condition: Condition | ''
  auctionStatus: AuctionStatus | ''
  address: string
  name: string
  phone: string
  email: string
}

const EMPTY_STATE: QuizState = {
  situation: '',
  timeline: '',
  condition: '',
  auctionStatus: '',
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
  { value: 'other', icon: 'more_horiz', label: 'Other' },
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

const AUCTION_TILES: { value: AuctionStatus; icon: string; label: string }[] = [
  { value: 'yes', icon: 'gavel', label: 'Yes' },
  { value: 'no', icon: 'home', label: 'No' },
  { value: 'not-sure', icon: 'help', label: 'Not sure' },
]

type SellLandingProps = {
  phoneDisplay: string
  phoneTel: string
  showBookingCta?: boolean
  variant?: 'general' | 'tax'
}

function initialQuizState(): QuizState {
  return { ...EMPTY_STATE, situation: 'tax-delinquent' }
}

export function SellLanding({ phoneDisplay, phoneTel, showBookingCta = false, variant = 'general' }: SellLandingProps) {
  const isTaxLanding = variant === 'tax'
  const totalSteps = isTaxLanding ? 4 : 3
  const finalStep = isTaxLanding ? 4 : 3
  const [step, setStep] = useState<FormStep>(1)
  const [state, setState] = useState<QuizState>(() => initialQuizState())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [manifestId, setManifestId] = useState<string | null>(null)
  const [leadId, setLeadId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quizStartedFired, setQuizStartedFired] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [navJumpVisible, setNavJumpVisible] = useState(false)
  const toolCardRef = useRef<HTMLDivElement | null>(null)
  const stage3AutosavedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    captureAttribution()
    firePpcTrackingEvent('skc_phone_number_selected', {
      ppc_phone_display: phoneDisplay,
      ppc_phone_tel: phoneTel,
      landing_page: window.location.href,
    })
  }, [phoneDisplay, phoneTel])

  useEffect(() => {
    const el = toolCardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      ([entry]) => {
        // Show the nav CTA only when the form is scrolled out of view
        setNavJumpVisible(!entry.isIntersecting)
      },
      { threshold: 0.05, rootMargin: '-80px 0px 0px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const postPartial = useCallback(async (currentStep: FormStep, partial: Partial<QuizState>) => {
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

  const trackFormError = (message: string, field: string, formStep: FormStep) => {
    setError(message)
    fireFormError(message, {
      form_step: formStep,
      field,
      situation: state.situation || undefined,
      timeline: state.timeline || undefined,
      condition: state.condition || undefined,
      auctionStatus: state.auctionStatus || undefined,
    })
  }

  useEffect(() => {
    if (submitted || step !== finalStep) return

    const address = state.address.trim()
    const name = state.name.trim()
    const phone = state.phone.trim()
    const email = state.email.trim().toLowerCase()
    const phoneDigits = phone.replace(/\D/g, '')

    if (!address || !name || phoneDigits.length < 10 || !email.includes('@')) return

    const autosaveKey = [address, name, phoneDigits, email].join('|')
    if (stage3AutosavedKeyRef.current === autosaveKey) return

    const timer = window.setTimeout(async () => {
      try {
        const attribution = getAttribution()
        const r = await fetch('/api/leads/ppc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'autosave',
            step: finalStep,
            address,
            situation: state.situation,
            timeline: state.timeline,
            condition: state.condition,
            auctionStatus: state.auctionStatus || undefined,
            contact: { name, phone, email },
            attribution,
          }),
        })
        const json = await r.json().catch(() => null)
        if (r.ok && json?.ok) {
          stage3AutosavedKeyRef.current = autosaveKey
          if (json.manifestId) setManifestId(json.manifestId)
          const stage3Payload = {
            form_step: finalStep,
            form_status: 'stage_3_complete_no_submit',
            form_submitted: false,
            has_address: true,
            has_name: true,
            has_phone: true,
            has_email: true,
            situation: state.situation || undefined,
            timeline: state.timeline || undefined,
            condition: state.condition || undefined,
            auctionStatus: state.auctionStatus || undefined,
          }
          firePpcTrackingEvent('step_3_field_completed', stage3Payload)
          fireConversion('lead_stage3_completed', stage3Payload)
        }
      } catch {
        // best-effort only; final submit still owns the real conversion.
      }
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [
    state.address,
    state.auctionStatus,
    state.condition,
    state.email,
    state.name,
    state.phone,
    state.situation,
    state.timeline,
    finalStep,
    step,
    submitted,
  ])

  const validateTimelineAndCondition = (formStep: FormStep) => {
    if (state.timeline && state.condition) return true
    trackFormError(
      'Answer both questions to continue.',
      !state.timeline ? 'timeline' : 'condition',
      formStep,
    )
    return false
  }

  const advance = (toStep: FormStep) => {
    setError(null)
    if (toStep === 2) {
      if (!state.situation) {
        trackFormError('Pick a situation to continue.', 'situation', 1)
        return
      }
      if (!quizStartedFired) {
        fireConversion('lead_quiz_started', {
          form_step: 1,
          situation: state.situation,
        })
        setQuizStartedFired(true)
      }
      postPartial(1, { situation: state.situation })
    }
    if (toStep === 3) {
      if (isTaxLanding) {
        if (!state.auctionStatus) {
          trackFormError('Answer this question to continue.', 'auctionStatus', 2)
          return
        }
        postPartial(2, {
          situation: state.situation,
          auctionStatus: state.auctionStatus,
        })
      } else if (!validateTimelineAndCondition(2)) {
        return
      }
    }
    if ((isTaxLanding && toStep === 4) || (!isTaxLanding && toStep === 3)) {
      const qualificationStep = isTaxLanding ? 3 : 2
      if (!validateTimelineAndCondition(qualificationStep)) return
      fireConversion('lead_quiz_qualified', {
        form_step: qualificationStep,
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
        auctionStatus: state.auctionStatus || undefined,
      })
      postPartial(qualificationStep, {
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
        auctionStatus: state.auctionStatus || undefined,
      })
    }
    setStep(toStep)
  }

  const submit = async () => {
    setError(null)
    if (!state.address.trim() || !state.name.trim() || !state.phone.trim() || !state.email.trim()) {
      trackFormError('We need all four to send you a custom offer.', 'contact_fields', finalStep)
      return
    }
    setSubmitting(true)
    try {
      const attribution = getAttribution()
      const r = await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: finalStep,
          intent: 'submit',
          address: state.address,
          situation: state.situation,
          timeline: state.timeline,
          condition: state.condition,
          auctionStatus: state.auctionStatus || undefined,
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
      fireConversion('lead_submitted', {
        form_step: finalStep,
        form_status: 'submitted',
        form_submitted: true,
        stage3_autosaved: Boolean(manifestId || json.manifestId),
        has_address: true,
        has_name: true,
        has_phone: true,
        has_email: true,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: state.condition || undefined,
        auctionStatus: state.auctionStatus || undefined,
      })
      setLeadId(json.leadId ?? null)
      setManifestId(json.manifestId ?? null)
      setSubmitted(true)
    } catch (e) {
      trackFormError(e instanceof Error ? e.message : 'Submit failed. Please try again or call us.', 'submit', finalStep)
    } finally {
      setSubmitting(false)
    }
  }

  const openBooking = () => setBookingOpen(true)
  const closeBooking = () => setBookingOpen(false)

  const bookingUrl = (() => {
    const base = process.env.NEXT_PUBLIC_BOOKING_URL ?? 'https://savingkc.com/call/'
    const params = new URLSearchParams({ source: 'ppc-landing' })
    if (leadId) params.set('leadId', leadId)
    if (manifestId) params.set('manifestId', manifestId)
    return `${base}?${params.toString()}`
  })()

  useEffect(() => {
    if (!bookingOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeBooking() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [bookingOpen])

  const select = <K extends keyof QuizState>(key: K, value: QuizState[K]) => {
    const previous = state[key]
    setState((s) => ({ ...s, [key]: value }))
    if (previous === value) return

    if (key === 'situation') {
      firePpcTrackingEvent('situation_selected', {
        form_step: 1,
        situation: value,
      })
    }
    if (key === 'timeline') {
      firePpcTrackingEvent('timeline_selected', {
        form_step: isTaxLanding ? 3 : 2,
        situation: state.situation || undefined,
        timeline: value,
      })
    }
    if (key === 'condition') {
      firePpcTrackingEvent('condition_selected', {
        form_step: isTaxLanding ? 3 : 2,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: value,
      })
    }
    if (key === 'auctionStatus') {
      firePpcTrackingEvent('auction_status_selected', {
        form_step: 2,
        situation: state.situation || undefined,
        auctionStatus: value,
      })
    }
  }

  const scrollToQuiz = () => document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth' })
  const scrollToId = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const trackPhoneClick = (clickLocation: string) => {
    firePpcTrackingEvent('phone_click', {
      phone_number: phoneTel,
      phone_display: phoneDisplay,
      click_location: clickLocation,
    })
  }
  const faqs = isTaxLanding ? TAX_FAQS : FAQS
  const isAuctionStep = isTaxLanding && step === 2
  const isTimelineStep = isTaxLanding ? step === 3 : step === 2
  const timelineNextStep: FormStep = isTaxLanding ? 4 : 3
  const stepLabel = step === finalStep
    ? '15 seconds to finish'
    : isAuctionStep
      ? '10 seconds'
      : isTimelineStep
        ? '20 seconds'
        : '30 seconds'

  return (
    <div className={`skc-sell ${isTaxLanding ? 'tax-landing' : ''}`}>
      {/* ============ TOP BAR ============ */}
      <div className="topbar">
        <div className="container topbar-inner">
          <a href="#quiz" className="logo" onClick={scrollToId('quiz')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/skc-logo.png" alt="Saving KC Homebuyers" className="topbar-logo" width={489} height={141} />
          </a>
          <nav className="nav-links" aria-label="primary">
            {isTaxLanding ? (
              <>
                <a href="#timeline" onClick={scrollToId('timeline')}>Your fresh start</a>
                <a href="#stages" onClick={scrollToId('stages')}>Stage</a>
                <a href="#team" onClick={scrollToId('team')}>Who we are</a>
              </>
            ) : (
              <>
                <a href="#how" onClick={scrollToId('how')}>How it works</a>
                <a href="#about" onClick={scrollToId('about')}>About us</a>
              </>
            )}
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews')}>Reviews</a>
          </nav>
          <div className="topbar-right">
            <div className="topbar-trust">
              <span className="stars">★★★★★</span>
              <span><strong>100+</strong> KC homeowners helped</span>
            </div>
            <a href={`tel:${phoneTel}`} className="topbar-phone" onClick={() => trackPhoneClick('topbar')}>
              <span className="material-symbols-outlined" aria-hidden>call</span>
              {phoneDisplay}
            </a>
            {navJumpVisible && (
              <a
                href="#quiz"
                className="nav-jump visible"
                onClick={scrollToId('quiz')}
              >
                {isTaxLanding ? 'Start Fresh' : 'Get My Offer'}
                <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
              </a>
            )}
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
            {isTaxLanding ? (
              <>
                <a href="#timeline" onClick={scrollToId('timeline')}>Your fresh start</a>
                <a href="#stages" onClick={scrollToId('stages')}>Stage</a>
                <a href="#team" onClick={scrollToId('team')}>Who we are</a>
              </>
            ) : (
              <>
                <a href="#how" onClick={scrollToId('how')}>How it works</a>
                <a href="#about" onClick={scrollToId('about')}>About us</a>
              </>
            )}
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews')}>Reviews</a>
            <div className="mobile-trust">
              <span className="stars">★★★★★</span>
              <span><strong>100+</strong> KC homeowners helped</span>
            </div>
            <a href={`tel:${phoneTel}`} className="mobile-phone" onClick={() => trackPhoneClick('mobile_menu')}>
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
                <span className="dot"></span> {isTaxLanding ? 'Tax-delinquent specialists · KC metro' : 'Kansas City • MO + KS'}
              </div>
              {isTaxLanding ? (
                <>
                  <h1>Behind on property taxes <span className="accent">&amp; want to sell?</span></h1>
                  <p className="tax-hero-summary">
                    Back taxes, penalties, county deadlines, and letters you do not want to open can make the house feel like a clock is running. We help you see the real number, protect what equity is left, and move without repairs, agents, or public listing pressure.
                  </p>
                  <div className="fresh-start">
                    <span className="fresh-start-icon material-symbols-outlined" aria-hidden>wb_sunny</span>
                    <span className="fresh-start-text">
                      The <span className="em">fresh start</span>{' '}you&apos;ve been waiting for.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <h1>Sell My House In <span className="accent">Kansas City</span> Today.</h1>
                  <div className="sub">
                    <p>Back taxes. An inherited headache. A tenant who won’t leave. Repairs that never end.</p>
                    <p>Whatever stress you’re facing, you don’t have to fix it, clean it, or explain it. Just give us the address and we’ll bring you a fair cash offer in under an hour. You pick the closing date.</p>
                  </div>
                  <div className="fresh-start">
                    <span className="fresh-start-icon material-symbols-outlined" aria-hidden>wb_sunny</span>
                    <span className="fresh-start-text">
                      The <span className="em">fresh start</span>{' '}you&apos;ve been waiting for.
                    </span>
                  </div>
                </>
              )}

              <ul className="hero-bullets">
                <li><span className="check">✓</span><span><strong>$0 due before you sell.</strong></span></li>
                <li><span className="check">✓</span><span><strong>100% private.</strong> <span className="muted-inline">No yard signs. No open houses.</span></span></li>
                <li><span className="check">✓</span><span><strong>Close in 7-60 days</strong> <span className="muted-inline">- you pick the day.</span></span></li>
                <li><span className="check">✓</span><span><strong>Back taxes paid at closing.</strong></span></li>
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
            <div className="tool-card" ref={toolCardRef}>
              <span className="tool-eyebrow">
                <span className="material-symbols-outlined" aria-hidden>{isTaxLanding ? 'wb_sunny' : 'bolt'}</span>
                {isTaxLanding ? 'Your fresh start starts here' : 'Start here'}
              </span>
              <h2>{isTaxLanding ? 'Get My Cash Offer In 1 hour.' : 'Get Your Cash Offer in 1 hour.'}</h2>
              <p className="tool-sub">
                {isTaxLanding
                  ? "Four quick questions. Answer or don't."
                  : 'Get a cash-offer range based on your property location, condition, and timeline in less than 1 hour.'}
              </p>

              <div className="step-indicator">
                <span className="step-pill" aria-label={`Step ${step} of ${totalSteps}`}>
                  <span className="step-num-circle">{step}</span>
                  <span className="step-num-text">Step {step} of {totalSteps}</span>
                </span>
                <span className="step-track">
                  <span className="step-track-fill" style={{ width: `${(step / totalSteps) * 100}%` }} />
                </span>
              </div>
              <div className="step-label">
                {stepLabel}
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
                    We&apos;ll text and email your cash-offer range within the hour. If anything needs clarification, we&apos;ll reach out directly.
                  </p>
                  {showBookingCta && (
                    <button type="button" className="btn-continue" onClick={openBooking}>
                      Book a 15-min Call
                      <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                    </button>
                  )}
                </div>
              ) : step === 1 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field form-field-prominent">
                    <span className="field-label">
                      {isTaxLanding ? 'Are you behind on property taxes?' : "What's your situation?"}
                    </span>
                    {isTaxLanding ? (
                      <div className="radio-group yesno">
                        <button
                          type="button"
                          className={`radio-tile ${state.situation === 'tax-delinquent' ? 'selected' : ''}`}
                          onClick={() => select('situation', 'tax-delinquent')}
                        >
                          <span className="material-symbols-outlined" aria-hidden>warning</span>
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`radio-tile ${state.situation === 'other' ? 'selected' : ''}`}
                          onClick={() => select('situation', 'other')}
                        >
                          <span className="material-symbols-outlined" aria-hidden>check_circle</span>
                          No / Not sure
                        </button>
                      </div>
                    ) : (
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
                    )}
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
              ) : isAuctionStep ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field form-field-prominent">
                    <span className="field-label">Has your home been sold at auction?</span>
                    <div className="radio-group three-col">
                      {AUCTION_TILES.map(({ value, icon, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`radio-tile ${state.auctionStatus === value ? 'selected' : ''}`}
                          onClick={() => select('auctionStatus', value)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>{icon}</span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button type="button" className="btn-continue" onClick={() => advance(3)}>
                    Continue
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                </div>
              ) : isTimelineStep ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field">
                    <label>{isTaxLanding ? 'How soon would you like this behind you?' : 'How soon do you need to sell?'}</label>
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
                    <label>{isTaxLanding ? 'What shape is the property in?' : 'Condition of the property'}</label>
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
                  <button type="button" className="btn-continue" onClick={() => advance(timelineNextStep)}>
                    {isTaxLanding ? 'See My Fresh-Start Number' : 'See My Offer Range'}
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
                    {isTaxLanding ? 'Fresh-start number ready — finish below to see it.' : 'Cash-offer range ready — finish below to see it.'}
                  </div>
                  <div className="form-field">
                    <label htmlFor="address">Property address</label>
                    <AddressAutocomplete
                      id="address"
                      placeholder="Start typing your address…"
                      value={state.address}
                      onChange={(v) => select('address', v)}
                      onPlaceSelected={() => {
                        firePpcTrackingEvent('address_selected', {
                          form_step: finalStep,
                          address_source: 'google_places',
                          has_address: true,
                          situation: state.situation || undefined,
                          timeline: state.timeline || undefined,
                          condition: state.condition || undefined,
                        })
                      }}
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

      {isTaxLanding && <TaxTrustStrip />}

      {isTaxLanding ? (
        <>
          <TaxFreshStartTimeline />
          <TaxDecisionRows scrollToQuiz={scrollToQuiz} />
          <TaxGuarantee />
          <TaxTeamSection />
        </>
      ) : (
        <>
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
                    We pull title, check the back-tax balance, and structure an offer that actually accounts for your situation — probate, liens, code violations, all of it.
                  </p>
                </div>
                <div className="step">
                  <div className="step-icon">
                    <span className="material-symbols-outlined" style={{ fontSize: 30 }} aria-hidden>key</span>
                  </div>
                  <div className="step-num">Step 3 · 7-60 days</div>
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
                <SitCard icon="gavel" title="Back taxes piling up" body="Stop the auction clock and walk away with the equity you'd otherwise lose at the courthouse steps. We pay the county directly." cta="Protect what you've built" />
                <SitCard icon="family_history" title="Inherited more than you bargained for" body="Turn a house full of memories and obligations into one clean check your family can split. We work alongside probate — you don't have to wait for it." cta="Honor the past, move forward" />
                <SitCard icon="person_off" title="Done being everybody's landlord" body="Hand us the keys, the tenant, and the headache. We close with renters in place — no evictions, no awkward conversations, no 60-day notices." cta="Get your weekends back" />
                <SitCard icon="construction" title="A house you can't afford to fix" body="Fire damage, foundation cracks, code violations, a kitchen frozen in 1978 — none of it scares us, and none of it lowers our offer the way a retail buyer would." cta="Sell it exactly as it sits" />
                <SitCard icon="schedule_send" title="Foreclosure, divorce, or a fast move" body="When life forces a fast decision, we move at your speed and protect your privacy. 14-day closings with title partners who already know our paperwork." cta="Close on your timeline" />
                <SitCard icon="landscape" title="Land or lots draining your wallet" body="Vacant lots, ag parcels, that infill piece your uncle left you — if it's costing you taxes every year and earning you nothing, we'll take it off your books." cta="Stop paying for nothing" />
              </div>
            </div>
          </section>
        </>
      )}

      {/* ============ MID CTA ============ */}
      <section className="block">
        <div className="container">
          <div className="mid-cta">
            <div className="mid-cta-content">
              <h2>
                {isTaxLanding ? 'Every month you wait,' : 'Every month you wait, this gets'}{' '}
                <span className="accent">{isTaxLanding ? 'the math gets worse.' : 'harder, not cheaper.'}</span>
              </h2>
              <p>
                {isTaxLanding
                  ? 'Interest compounds. Penalties stack. Auction dates lock. The number you can walk away with this week can be smaller next month. Get your real number now.'
                  : "Property problems compound. Taxes accrue interest. Vacant houses get vandalized. Estates rack up legal costs. Tenants disappear with the security deposit. The number you get six months from now will be smaller than the number you can get this week. Let's see yours."}
              </p>
              <div className="mid-cta-actions">
                <a href="#quiz" className="btn-secondary" onClick={(e) => { e.preventDefault(); scrollToQuiz() }}>
                  {isTaxLanding ? 'Start My Fresh Start' : 'See My Number'}
                  <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                </a>
                <a href={`tel:${phoneTel}`} className="btn-secondary" onClick={() => trackPhoneClick('mid_page_cta')}>
                  <span className="material-symbols-outlined" aria-hidden>call</span>
                  Call {phoneDisplay}
                </a>
              </div>
            </div>
            <div className="mid-cta-stat">
              <div className="stat-box">
                <div className="num">$45K</div>
                <div className="label">
                  {isTaxLanding ? 'Average walk-away cash' : "Average cash in homeowners' pockets at closing"}
                </div>
              </div>
              <div className="stat-box">
                <div className="num">18 days</div>
                <div className="label">
                  {isTaxLanding ? 'Fastest pre-DLT close' : 'Fastest close when you need out now'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!isTaxLanding && (
        <>
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
        </>
      )}

      {/* ============ TESTIMONIALS ============ */}
      <section className="block" id="reviews">
        <div className="container">
          <div className="section-eyebrow">{isTaxLanding ? 'Real fresh starts' : 'What KC homeowners say'}</div>
          <h2 className="section-title">
            {isTaxLanding ? (
              <>
                100+ KC neighbors. <span className="accent-green">All the way home.</span>
              </>
            ) : (
              '100+ neighbors. Real stories.'
            )}
          </h2>
          <p className="section-sub">
            {isTaxLanding
              ? 'No actors. Real sellers, real tax pressure, real closing-table outcomes.'
              : "These aren't paid testimonials. They're people we've actually helped — and you can ask them yourself before we close."}
          </p>

          <div className="testimonials">
            {(isTaxLanding ? TAX_TESTIMONIALS : TESTIMONIALS).map((testimonial) => (
              <Testimonial key={`${testimonial.initials}-${testimonial.name}`} {...testimonial} />
            ))}
          </div>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className="block" id="faq">
        <div className="container">
          <div className="section-eyebrow">Common questions</div>
          <h2 className="section-title">Questions worth asking.</h2>

          <div className="faq-list">
            {faqs.map((faq, i) => (
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
              {isTaxLanding ? 'Your ' : 'Stop wondering. '}
              <span className="accent">
                {isTaxLanding ? 'fresh start' : 'Find out what your house is actually worth in 30 seconds.'}
              </span>
              {isTaxLanding ? ' is one form away.' : ''}
            </h2>
            <p>
              {isTaxLanding
                ? '60 seconds. Four questions. Cash offer in an hour. Closing timeline built around title and your situation.'
                : 'No phone call until you ask. No pressure, no spam. Just a real offer range based on your address and your situation.'}
            </p>
            <a
              href="#quiz"
              className="btn-secondary lg"
              onClick={(e) => {
                e.preventDefault()
                scrollToQuiz()
              }}
            >
              {isTaxLanding ? 'Start My Fresh Start' : 'Get My Free Offer Estimate'}
              <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
            </a>
            <div className="micro">
              Or call us directly at{' '}
              <a href={`tel:${phoneTel}`} style={{ color: 'var(--text)' }} onClick={() => trackPhoneClick('bottom_cta_text')}>
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
            <a href={`tel:${phoneTel}`} onClick={() => trackPhoneClick('footer_contact')}>Contact</a>
          </div>
        </div>
      </footer>

      {bookingOpen && (
        <div
          className="call-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Book a 15-minute call"
          onClick={closeBooking}
        >
          <div className="call-modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="call-modal-close"
              aria-label="Close booking modal"
              onClick={closeBooking}
            >
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
            <iframe
              title="Book a 15-minute call"
              className="call-modal-iframe"
              src={bookingUrl}
            />
          </div>
        </div>
      )}
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

function TaxTrustStrip() {
  return (
    <section className="tax-trust-strip" aria-label="Trust signals">
      <div className="container tax-trust-inner">
        <div className="tax-trust-label">As trusted by</div>
        <div className="tax-trust-logos">
          <div className="tax-trust-logo">
            <div className="logo-kshb"><span className="num">41</span><span className="peacock" aria-hidden /></div>
            <span>KSHB · NBC</span>
          </div>
          <div className="tax-trust-logo">
            <div className="logo-kmbc"><span className="num">9</span><span className="net">abc</span></div>
            <span>KMBC · ABC</span>
          </div>
          <div className="tax-trust-logo">
            <div className="logo-bbb">BBB</div>
            <span>Accredited business</span>
          </div>
          <div className="tax-trust-logo">
            <div className="logo-kcbj">Kansas City<br /><strong>Business Journal</strong></div>
            <span>Local market coverage</span>
          </div>
          <div className="tax-trust-logo">
            <div className="stars">★★★★★</div>
            <span><strong>4.9</strong> · 100+ reviews</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function TaxFreshStartTimeline() {
  return (
    <section className="block tax-timeline-section" id="timeline">
      <div className="container">
        <div className="section-eyebrow">Fresh start in 60 minutes</div>
        <h2 className="section-title">
          Form today. <span className="accent-green">Offer today.</span>
        </h2>
        <p className="section-sub">Most &quot;we buy houses&quot; promises take weeks. Yours starts with a real number in the next hour.</p>

        <div className="tax-timeline">
          <div className="tax-timeline-rail" />
          {[
            ['1', 'Today', 'Tell us your story', '60 seconds. Four questions. We start the file right away.'],
            ['2', 'Today', 'Cash offer in hand', 'We check the tax pressure, title path, and walk you through the number.'],
            ['3', 'Closing day', 'Your fresh start', 'Check in hand. Back taxes paid. Title closed. You walk away clean.'],
          ].map(([day, label, title, body], index) => (
            <div className={`tax-timeline-step step-${index + 1}`} key={day}>
              <div className="tax-day">
                <span className="day-num">{day}</span>
                <span className="day-label">{label}</span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function TaxDecisionRows({ scrollToQuiz }: { scrollToQuiz: () => void }) {
  const rows = [
    {
      tone: 'brand',
      icon: 'gavel',
      stage: 'Pre-auction',
      title: '3+ years behind',
      body: 'You still own the house, but the county clock is getting louder.',
      ifLabel: 'Best move',
      ifValue: "Sell before the auction locks in someone else's timeline.",
      thenLabel: 'You walk away with',
      thenValue: <>Cash for the house · <span className="em">fresh start</span> in 14 days</>,
      cta: 'Start',
    },
    {
      tone: 'amber',
      icon: 'history',
      stage: 'Post-auction',
      title: 'Redemption window',
      body: 'The sale happened, but the deadline may not be closed yet.',
      ifLabel: 'Best move',
      ifValue: 'Move before the redemption period disappears.',
      thenLabel: 'You walk away with',
      thenValue: <>Cash before the deadline closes</>,
      cta: 'Start',
    },
    {
      tone: 'green',
      icon: 'savings',
      stage: 'Excess proceeds',
      title: 'Property already sold',
      body: 'The property may be gone, but the county may still be holding money.',
      ifLabel: 'Best move',
      ifValue: 'Check whether surplus funds are sitting at the county.',
      thenLabel: 'The county may owe you',
      thenValue: <>Excess proceeds — <span className="em">found money</span></>,
      cta: 'Check',
    },
  ]

  return (
    <section className="block tax-decision-section" id="stages">
      <div className="container">
        <div className="section-eyebrow">Where are you in this?</div>
        <h2 className="section-title">
          Find your stage. <span className="accent-green">See your fresh start.</span>
        </h2>
        <p className="section-sub">Three stages. Three different deadlines. Tap the one that feels closest.</p>

        <div className="tax-decision-block">
          <div className="decision-top">
            Whatever stage you&apos;re in, <strong>there&apos;s money on the table.</strong>
          </div>
          <div className="decision-rows">
            {rows.map((row) => (
              <button
                type="button"
                className={`decision-row decision-card ${row.tone}`}
                key={row.stage}
                onClick={scrollToQuiz}
              >
                <span className="decision-stage">{row.stage}</span>
                <span className="if-block decision-card-head">
                  <span className="if-icon">
                    <span className="material-symbols-outlined" aria-hidden>{row.icon}</span>
                  </span>
                  <span className="if-text">
                    <span className="decision-title">{row.title}</span>
                    <span className="decision-body">{row.body}</span>
                  </span>
                </span>
                <span className="if-label">{row.ifLabel}</span>
                <span className="if-value">{row.ifValue}</span>
                <span className="then-text">
                  <span className="then-label">{row.thenLabel}</span>
                  <span className="then-value">{row.thenValue}</span>
                </span>
                <span className="row-cta">
                  {row.cta}
                  <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="tax-county-chips">
          {[
            ['Jackson', 'MO'],
            ['Clay', 'MO'],
            ['Platte', 'MO'],
            ['Wyandotte', 'KS'],
            ['Johnson', 'KS'],
          ].map(([county, state]) => (
            <span className="tax-county-chip" key={county}>
              <span className="material-symbols-outlined" aria-hidden>location_on</span>
              {county} <span>{state}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function TaxTeamSection() {
  return (
    <section className="block tax-team-section" id="team">
      <div className="container">
        <div className="tax-team">
          <div className="tax-team-copy">
            <div className="section-eyebrow">Who you&apos;ll talk to</div>
            <h2 className="section-title">Local KC people, not a call center.</h2>
            <p>
              You&apos;ll talk with Ernest Dodson and Casey Davis from the Saving KC team. We know Jackson, Clay, Platte, Wyandotte, and Johnson County tax-sale timelines, and we keep the conversation private, direct, and pressure-free.
            </p>
            <div className="tax-team-proof">
              <span><strong>11+</strong> years in KC</span>
              <span><strong>100+</strong> homeowners helped</span>
              <span><strong>4.9</strong> Google rating</span>
            </div>
          </div>
          <div className="tax-team-cards" aria-label="Saving KC team">
            <article className="tax-team-card">
              <div className="tax-team-photo">
                <Image src="/ernest-profile.png" alt="Ernest Dodson" width={192} height={192} sizes="96px" />
              </div>
              <h3>Ernest Dodson</h3>
              <p className="tax-team-title">Lead House Hunter</p>
              <p>Walks through the tax pressure, the title path, and the number so you know exactly where you stand.</p>
            </article>
            <article className="tax-team-card">
              <div className="tax-team-photo">
                <Image src="/casey.jpg" alt="Casey Davis" width={192} height={192} sizes="96px" />
              </div>
              <h3>Casey Davis</h3>
              <p className="tax-team-title">Junior House Hunter</p>
              <p>Fast follow-up, clear next steps, and steady communication while the file moves toward closing.</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}

function TaxGuarantee() {
  return (
    <section className="block tax-guarantee-section">
      <div className="container">
        <div className="tax-guarantee">
          <div className="guarantee-seal">
            <span className="material-symbols-outlined" aria-hidden>verified_user</span>
            <span>Our promise</span>
          </div>
          <div className="guarantee-copy">
            <h2>
              The <span className="accent-green">no-catch</span> promise.
            </h2>
            <p>
              The number we give you is the number you walk away with, minus payoffs and back taxes, every penny disclosed before you sign.
            </p>
          </div>
          <div className="guarantee-checks">
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No fees</span>
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No commissions</span>
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No obligation</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Testimonial({
  initials,
  name,
  meta,
  quote,
  result,
}: {
  initials: string
  name: string
  meta: string
  quote: string
  result?: string
}) {
  return (
    <div className="testimonial">
      {result && (
        <span className="testimonial-result">
          <span className="material-symbols-outlined" aria-hidden>check</span>
          {result}
        </span>
      )}
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

const TESTIMONIALS: Array<{
  initials: string
  name: string
  meta: string
  quote: string
  result?: string
}> = [
  {
    initials: 'RM',
    name: 'Renee M.',
    meta: 'Inherited property · Jackson County, MO',
    quote: '"Three years of unpaid taxes on a house I inherited from my dad. Every other buyer wanted to deduct the taxes twice from the offer. Saving KC paid the back taxes at closing and still gave me a fair number. Closed in 18 days."',
  },
  {
    initials: 'DT',
    name: 'David T.',
    meta: 'Tired landlord · Wyandotte County, KS',
    quote: '"Bad tenants, busted HVAC, and I live in Denver. I didn’t have the time or the heart to deal with it. Ernest’s team handled the tenant conversation, took the property as-is with everything still inside. Done."',
  },
  {
    initials: 'JK',
    name: 'Jerome K.',
    meta: 'Pre-DLT auction · Jackson County, MO',
    quote: '"I was 60 days from the DLT auction. Two other ‘we buy houses’ guys ghosted me when they saw the title. Saving KC didn’t blink — closed in 14 days. I walked away with money instead of a court notice."',
  },
  {
    initials: 'SP',
    name: 'Sandra P.',
    meta: 'Probate sale · Clay County, MO',
    quote: '"My brother and I disagreed on everything about the estate. They worked with both of us, kept the communication separate when we needed it, and got us to closing without making it worse. That’s rare."',
  },
]

const TAX_TESTIMONIALS: typeof TESTIMONIALS = [
  {
    initials: 'JK',
    name: 'Jerome K.',
    meta: 'Jackson County, MO',
    result: 'Closed in 14 days',
    quote: '"I was 60 days from the DLT auction. Two other guys ghosted me. Saving KC didn’t blink."',
  },
  {
    initials: 'RM',
    name: 'Renee M.',
    meta: 'Wyandotte County, KS',
    result: 'Inherited · 18 days',
    quote: '"Three years of unpaid taxes on a house I inherited. They paid the back taxes at closing and still gave me a fair number."',
  },
  {
    initials: 'SP',
    name: 'Sandra P.',
    meta: 'Clay County, MO',
    result: '$12K in excess proceeds',
    quote: '"Had no idea money was sitting at the county. They walked me through the claim and didn’t charge a dime."',
  },
]

const TAX_FAQS: { q: string; a: string }[] = [
  {
    q: "Too late to sell if I'm 3+ years behind?",
    a: 'Almost never. Until the auction happens and the redemption period expires, you usually still have options. The earlier you talk to us, the more room there is to protect equity.',
  },
  {
    q: 'Do I have to pay the back taxes first?',
    a: 'No. The county can be paid directly at closing out of the sale proceeds. You do not need to write a check upfront to ask for an offer.',
  },
  {
    q: 'What are excess proceeds?',
    a: 'When a property sells at tax sale for more than the back taxes, the surplus may belong to the former owner. We can check the address and tell you if there may be money to claim.',
  },
  {
    q: 'Can you still buy during redemption?',
    a: 'Often, yes, but timing and state rules matter. Missouri and Kansas work differently, so the sooner we review the property, the better the math tends to be.',
  },
  {
    q: 'Any fees or commissions?',
    a: 'None. No agent commission, no seller closing costs from us, and no obligation. Any payoffs and back taxes are disclosed before you sign.',
  },
]

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
