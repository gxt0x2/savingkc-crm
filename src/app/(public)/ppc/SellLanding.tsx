'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { captureAttribution, getAttribution } from '@/lib/ppc/attribution'
import { fireConversion, fireFormError, firePpcTrackingEvent } from '@/lib/ppc/conversions'
import { getPpcSessionContext } from '@/lib/ppc/tracking-client'
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
type AddressSource = 'typed' | 'google_places'

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

type SellLandingProps = {
  phoneDisplay: string
  phoneTel: string
  showBookingCta?: boolean
  variant?: 'default' | 'tax'
}

const TAX_TIMELINE_STEPS = [
  {
    number: '1',
    label: 'Today',
    title: 'Tell us what is going on',
    body: 'Share the address, tax stage, and timeline. No judgment, no long intake, no pressure.',
    tone: 'today',
  },
  {
    number: '2',
    label: 'Tomorrow',
    title: 'We verify the tax picture',
    body: 'We review county records, title issues, liens, and repair risk so the offer reflects the real situation.',
    tone: 'tomorrow',
  },
  {
    number: '3',
    label: 'Closing Day',
    title: 'Taxes cleared at closing',
    body: 'The title company pays what is owed from closing funds, and you leave with a clean break.',
    tone: 'closing',
  },
]

const TAX_STAGE_COLUMNS = [
  {
    icon: 'event_upcoming',
    stage: 'Pre-Auction',
    kicker: 'County notices are starting to feel real',
    body: 'You still have leverage. A fast sale can clear the tax balance before the deadline and protect equity that could be lost at auction.',
    points: ['Stop waiting on payment plans that are not working', 'Avoid repairs, cleanup, showings, and listing delays', 'Know your offer path before the county date arrives'],
    cta: 'See my pre-auction path',
  },
  {
    icon: 'gavel',
    stage: 'Post-Auction',
    kicker: 'The clock is tighter, but options may remain',
    body: 'If the sale or lien process has already started, speed and title clarity matter. We look at redemption windows, payoff amounts, and whether a sale can still preserve value.',
    points: ['Review what can still be paid or redeemed', 'Coordinate with title before deadlines get worse', 'Move without public listing pressure'],
    cta: 'Check my options',
  },
  {
    icon: 'hourglass_top',
    stage: '3+ Years Behind / Long-Term Delinquent',
    kicker: 'Penalties and interest are compounding',
    body: 'When the balance has stacked up for years, the problem can feel too large to touch. We structure the offer around back taxes, liens, condition, and a realistic closing path.',
    points: ['Understand what the county and title will require', 'Sell as-is even with repairs or code issues', 'Turn a stuck property into a defined exit'],
    cta: 'Find my fresh start',
  },
]

export function SellLanding({ phoneDisplay, phoneTel, showBookingCta = false, variant = 'default' }: SellLandingProps) {
  const isTaxLanding = variant === 'tax'
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [state, setState] = useState<QuizState>(EMPTY_STATE)
  const [addressSource, setAddressSource] = useState<AddressSource>('typed')
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
  const addressCapturedKeyRef = useRef<string | null>(null)
  const potentialLeadKeyRef = useRef<string | null>(null)
  const formContextRef = useRef<Record<string, unknown>>({})
  const sectionViewedRef = useRef<Set<string>>(new Set())
  const scrollDepthRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    formContextRef.current = {
      form_step: step,
      situation: state.situation || undefined,
      timeline: state.timeline || undefined,
      condition: state.condition || undefined,
      form_status: submitted ? 'submitted' : step === 3 ? 'step_3_visible' : 'in_progress',
    }
  }, [state.condition, state.situation, state.timeline, step, submitted])

  useEffect(() => {
    captureAttribution()
    firePpcTrackingEvent('ppc_visit_started', {
      form_step: 1,
      page_path: window.location.pathname,
      landing_page: window.location.href,
      referrer: document.referrer || undefined,
    })
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

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-track-section]'))
    if (!sections.length) return

    const markViewed = (section: string) => {
      if (sectionViewedRef.current.has(section)) return
      sectionViewedRef.current.add(section)
      firePpcTrackingEvent('section_viewed', {
        section,
        ...formContextRef.current,
      })
    }

    if (typeof IntersectionObserver === 'undefined') {
      markViewed('hero_quiz')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.35) continue
          const section = entry.target instanceof HTMLElement ? entry.target.dataset.trackSection : undefined
          if (section) markViewed(section)
        }
      },
      { threshold: [0.35, 0.55] },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const thresholds = [25, 50, 75, 90]
    let ticking = false

    const measure = () => {
      ticking = false
      const doc = document.documentElement
      const body = document.body
      const scrollHeight = Math.max(doc.scrollHeight, body?.scrollHeight ?? 0)
      if (scrollHeight <= window.innerHeight + 200) return
      const viewed = window.scrollY + window.innerHeight
      const depth = scrollHeight <= 0 ? 100 : Math.round((viewed / scrollHeight) * 100)

      for (const threshold of thresholds) {
        if (depth < threshold || scrollDepthRef.current.has(threshold)) continue
        scrollDepthRef.current.add(threshold)
        firePpcTrackingEvent('scroll_depth_reached', {
          scroll_depth: threshold,
          ...formContextRef.current,
        })
      }
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const postPartial = useCallback(async (currentStep: 1 | 2 | 3, partial: Partial<QuizState>) => {
    try {
      const attribution = getAttribution()
      const { sessionId, visitorId } = getPpcSessionContext()
      await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: currentStep,
          ...partial,
          attribution,
          sessionId,
          visitorId,
          smsConsent: true,
        }),
      })
    } catch {
      // best-effort
    }
  }, [])

  const postPpcLeadSignal = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const attribution = getAttribution()
      const { sessionId, visitorId } = getPpcSessionContext()
      const response = await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          attribution,
          sessionId,
          visitorId,
          smsConsent: true,
        }),
      })
      return await response.json().catch(() => null)
    } catch {
      return null
    }
  }, [])

  const trackFormError = (message: string, field: string, formStep: 1 | 2 | 3) => {
    setError(message)
    fireFormError(message, {
      form_step: formStep,
      field,
      situation: state.situation || undefined,
      timeline: state.timeline || undefined,
      condition: state.condition || undefined,
    })
  }

  useEffect(() => {
    if (submitted || step !== 3) return

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
        const { sessionId, visitorId } = getPpcSessionContext()
        const r = await fetch('/api/leads/ppc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'autosave',
            step: 3,
            address,
            addressSource,
            situation: state.situation,
            timeline: state.timeline,
            condition: state.condition,
            contact: { name, phone, email },
            attribution,
            sessionId,
            visitorId,
            smsConsent: true,
          }),
        })
        const json = await r.json().catch(() => null)
        if (r.ok && json?.ok) {
          stage3AutosavedKeyRef.current = autosaveKey
          if (json.manifestId) setManifestId(json.manifestId)
          const stage3Payload = {
            form_step: 3,
            form_status: 'stage_3_complete_no_submit',
            form_submitted: false,
            has_address: true,
            address_source: addressSource,
            has_name: true,
            has_phone: true,
            has_email: true,
            sms_consent: true,
            situation: state.situation || undefined,
            timeline: state.timeline || undefined,
            condition: state.condition || undefined,
          }
          firePpcTrackingEvent('step_3_field_completed', stage3Payload)
        }
      } catch {
        // best-effort only; final submit still owns the real conversion.
      }
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [
    state.address,
    addressSource,
    state.condition,
    state.email,
    state.name,
    state.phone,
    state.situation,
    state.timeline,
    step,
    submitted,
  ])

  useEffect(() => {
    if (submitted || step !== 3) return

    const address = state.address.trim().replace(/\s+/g, ' ')
    if (address.length < 8 || !/\d/.test(address)) return

    const key = `${address}|${addressSource}`
    if (addressCapturedKeyRef.current === key) return

    const timer = window.setTimeout(async () => {
      const json = await postPpcLeadSignal({
        intent: 'address_capture',
        step: 3,
        address,
        addressSource,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: state.condition || undefined,
      })
      if (json?.ok) addressCapturedKeyRef.current = key
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [
    addressSource,
    postPpcLeadSignal,
    state.address,
    state.condition,
    state.situation,
    state.timeline,
    step,
    submitted,
  ])

  useEffect(() => {
    if (submitted || step !== 3) return

    const address = state.address.trim().replace(/\s+/g, ' ')
    const name = state.name.trim()
    const phone = state.phone.trim()
    const email = state.email.trim().toLowerCase()
    const phoneDigits = phone.replace(/\D/g, '')
    const hasPhone = phoneDigits.length >= 10
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    const hasSubmitFields = Boolean(address && name && hasPhone && hasEmail)

    if (address.length < 8 || !/\d/.test(address) || hasSubmitFields || (!hasPhone && !hasEmail)) return

    const key = [address, name, hasPhone ? phoneDigits : '', hasEmail ? email : '', addressSource].join('|')
    if (potentialLeadKeyRef.current === key) return

    const timer = window.setTimeout(async () => {
      const json = await postPpcLeadSignal({
        intent: 'potential',
        step: 3,
        address,
        addressSource,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: state.condition || undefined,
        contact: {
          name: name || undefined,
          phone: hasPhone ? phone : undefined,
          email: hasEmail ? email : undefined,
        },
      })
      if (json?.ok) {
        potentialLeadKeyRef.current = key
        if (json.manifestId) setManifestId(json.manifestId)
      }
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [
    addressSource,
    postPpcLeadSignal,
    state.address,
    state.condition,
    state.email,
    state.name,
    state.phone,
    state.situation,
    state.timeline,
    step,
    submitted,
  ])

  const advance = (toStep: 1 | 2 | 3) => {
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
      firePpcTrackingEvent('form_step_completed', {
        form_step: 1,
        next_step: 2,
        situation: state.situation,
      })
    }
    if (toStep === 3) {
      if (!state.timeline || !state.condition) {
        trackFormError('Answer both questions to continue.', !state.timeline ? 'timeline' : 'condition', 2)
        return
      }
      fireConversion('lead_quiz_qualified', {
        form_step: 2,
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
      })
      postPartial(2, {
        situation: state.situation,
        timeline: state.timeline,
        condition: state.condition,
      })
      firePpcTrackingEvent('form_step_completed', {
        form_step: 2,
        next_step: 3,
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
      trackFormError('We need all four to send you a custom offer.', 'contact_fields', 3)
      return
    }
    setSubmitting(true)
    try {
      const attribution = getAttribution()
      const { sessionId, visitorId } = getPpcSessionContext()
      const r = await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 3,
          intent: 'submit',
          address: state.address,
          addressSource,
          situation: state.situation,
          timeline: state.timeline,
          condition: state.condition,
          contact: {
            name: state.name,
            phone: state.phone,
            email: state.email,
          },
          attribution,
          sessionId,
          visitorId,
          smsConsent: true,
        }),
      })
      const json = await r.json()
      if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'Submit failed')
      fireConversion('lead_submitted', {
        form_step: 3,
        form_status: 'submitted',
        form_submitted: true,
        stage3_autosaved: Boolean(manifestId || json.manifestId),
        has_address: true,
        address_source: addressSource,
        has_name: true,
        has_phone: true,
        has_email: true,
        sms_consent: true,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: state.condition || undefined,
      })
      setLeadId(json.leadId ?? null)
      setManifestId(json.manifestId ?? null)
      setSubmitted(true)
    } catch (e) {
      trackFormError(e instanceof Error ? e.message : 'Submit failed. Please try again or call us.', 'submit', 3)
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
        form_step: 2,
        situation: state.situation || undefined,
        timeline: value,
      })
    }
    if (key === 'condition') {
      firePpcTrackingEvent('condition_selected', {
        form_step: 2,
        situation: state.situation || undefined,
        timeline: state.timeline || undefined,
        condition: value,
      })
    }
  }

  const updateAddress = (value: string, source: AddressSource = 'typed') => {
    setAddressSource(source)
    select('address', value)
  }

  const trackCtaClick = (clickLocation: string, targetSection = 'quiz') => {
    firePpcTrackingEvent('cta_click', {
      click_location: clickLocation,
      target_section: targetSection,
      ...formContextRef.current,
    })
  }

  const scrollToQuiz = () => document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth' })
  const jumpToQuiz = (e: MouseEvent<HTMLAnchorElement>, clickLocation: string) => {
    e.preventDefault()
    trackCtaClick(clickLocation)
    scrollToQuiz()
  }

  const scrollToId = (id: string, clickLocation: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setMobileMenuOpen(false)
    firePpcTrackingEvent('nav_click', {
      click_location: clickLocation,
      target_section: id,
      ...formContextRef.current,
    })
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const trackPhoneClick = (clickLocation: string) => {
    firePpcTrackingEvent('phone_click', {
      phone_number: phoneTel,
      phone_display: phoneDisplay,
      click_location: clickLocation,
      ...formContextRef.current,
    })
  }

  return (
    <div className={`skc-sell ${isTaxLanding ? 'tax-landing' : ''}`}>
      {/* ============ TOP BAR ============ */}
      <div className="topbar">
        <div className="container topbar-inner">
          <a href="#quiz" className="logo" onClick={scrollToId('quiz', 'topbar_logo')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/skc-logo.png" alt="Saving KC Homebuyers" className="topbar-logo" width={489} height={141} />
          </a>
          <nav className="nav-links" aria-label="primary">
            <a href="#how" onClick={scrollToId('how', 'top_nav_how')}>How it works</a>
            {isTaxLanding && <a href="#roles" onClick={scrollToId('roles', 'top_nav_roles')}>Where you are</a>}
            <a href="#about" onClick={scrollToId('about', 'top_nav_about')}>About us</a>
            <a href="#faq" onClick={scrollToId('faq', 'top_nav_faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews', 'top_nav_reviews')}>Reviews</a>
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
                onClick={(e) => jumpToQuiz(e, 'sticky_offer_cta')}
              >
                Get My Offer
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
            <a href="#how" onClick={scrollToId('how', 'mobile_nav_how')}>How it works</a>
            {isTaxLanding && <a href="#roles" onClick={scrollToId('roles', 'mobile_nav_roles')}>Where you are</a>}
            <a href="#about" onClick={scrollToId('about', 'mobile_nav_about')}>About us</a>
            <a href="#faq" onClick={scrollToId('faq', 'mobile_nav_faq')}>FAQ</a>
            <a href="#reviews" onClick={scrollToId('reviews', 'mobile_nav_reviews')}>Reviews</a>
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
      <section className="hero" id="quiz" data-track-section="hero_quiz">
        <div className="container">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="hero-eyebrow">
                <span className="dot"></span> Kansas City • MO + KS
              </div>
              {isTaxLanding ? (
                <>
                  <h1>Behind on property taxes and want to sell?</h1>
                  <p className="tax-hero-summary">
                    Tax bills, penalties, county letters, and auction dates can turn a house into a source of daily stress. We help KC owners sell as-is, clear the tax problem at closing, and move forward without repairs, cleanout, or public showings.
                  </p>
                  <div className="fresh-start-panel" aria-label="Fresh start timing">
                    <span className="material-symbols-outlined" aria-hidden>verified</span>
                    <div>
                      <strong>Fresh start in 60 minutes</strong>
                      <span>Form today. Offer today.</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h1>Sell My House In Kansas City Today.</h1>
                  <p className="sub">
                    Back taxes. A house you didn&apos;t ask for. A tenant you can&apos;t get out. Repairs you stopped counting. Whatever it is, you don&apos;t have to fix it, clean it, or explain it. Tell us the address. We bring a fair cash number in an hour. You pick the day it closes.
                  </p>
                </>
              )}

              <ul className="hero-bullets">
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>{isTaxLanding ? 'Back taxes can be handled at closing.' : 'You pay $0.'}</strong> {isTaxLanding ? 'You do not have to catch everything up before talking with us. The payoff can be built into the title closing.' : 'No fees, no commissions, no repairs, and no cleanup. The number we say is the check you get.'}
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>Keep your privacy.</strong> Handle things quietly at closing. {isTaxLanding ? 'No public listing, no neighbors walking through, and no shame about how long this has been going on.' : 'Probate, liens, back taxes, hoarder mess. No neighbors. No judgment.'}
                  </span>
                </li>
                <li>
                  <span className="check">✓</span>
                  <span>
                    <strong>{isTaxLanding ? 'Move before the county has more control.' : 'Pick your payday.'}</strong> {isTaxLanding ? 'We focus on speed, title clarity, and a clean path forward while there is still time to make a decision.' : 'Close in 14 days if you need out fast, or take 60. You set the pace.'}
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
            <div className="tool-card" ref={toolCardRef}>
              <span className="tool-eyebrow">
                <span className="material-symbols-outlined" aria-hidden>bolt</span>
                Start here
              </span>
              <h2>{isTaxLanding ? 'Your Fresh Start Starts Here' : 'Get Your Cash Offer in 1 hour.'}</h2>
              <p className="tool-sub">
                {isTaxLanding
                  ? 'Answer a few questions so we can review the property, tax stage, condition, and best next step.'
                  : 'Get a cash-offer range based on your property location, condition, and timeline in less than 1 hour.'}
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
                {isTaxLanding ? 'Fresh start in 60 minutes' : step === 3 ? '15 seconds to finish' : step === 2 ? '20 seconds' : '30 seconds'}
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
                      onChange={(v) => updateAddress(v, 'typed')}
                      onPlaceSelected={(address) => {
                        updateAddress(address, 'google_places')
                        firePpcTrackingEvent('address_selected', {
                          form_step: 3,
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
                    We never sell your info. By clicking, you agree we may call, text, or email about your property offer. Consent is not required to sell. Msg/data rates may apply. Reply STOP to opt out.
                  </p>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="block" id="how" data-track-section="how_it_works">
        <div className="container">
          {isTaxLanding ? (
            <>
              <div className="section-eyebrow">Fresh start plan</div>
              <h2 className="section-title">Form today. Offer today.</h2>
              <p className="section-sub">
                A tax problem feels complicated because the deadlines, payoff balances, and title questions are all moving at once. We make the next step visible fast.
              </p>

              <div className="tax-timeline-grid">
                {TAX_TIMELINE_STEPS.map((item) => (
                  <TaxTimelineStep key={item.label} {...item} />
                ))}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </section>

      {/* ============ SITUATIONS ============ */}
      <section className="block" id={isTaxLanding ? 'roles' : 'about'} data-track-section={isTaxLanding ? 'tax_stage_roles' : 'situations'}>
        <div className="container">
          {isTaxLanding ? (
            <>
              <div className="section-eyebrow">Find your role</div>
              <h2 className="section-title">See your fresh start from where you are now.</h2>
              <p className="section-sub">
                The right next step depends on how far the tax process has gone. Pick the column that sounds closest, then start the form so we can review the details.
              </p>

              <div className="tax-stage-columns">
                {TAX_STAGE_COLUMNS.map((stage) => (
                  <TaxStageColumn
                    key={stage.stage}
                    {...stage}
                    onClick={(e) => jumpToQuiz(e, `tax_stage_${stage.stage.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="section-eyebrow">Who we help</div>
              <h2 className="section-title">If life put you here, we can help.</h2>
              <p className="section-sub">
                No matter how you ended up holding this house, you&apos;re not the first and you won&apos;t be the last. We&apos;ve built the offer for every one of these — quietly, fairly, fast.
              </p>

              <div className="situations-grid">
                <SitCard icon="gavel" title="Back taxes piling up" body="Stop the auction clock and walk away with the equity you’d otherwise lose at the courthouse steps. We pay the county directly." cta="Protect what you’ve built" onClick={(e) => jumpToQuiz(e, 'situation_card_back_taxes')} />
                <SitCard icon="family_history" title="Inherited more than you bargained for" body="Turn a house full of memories and obligations into one clean check your family can split. We work alongside probate — you don’t have to wait for it." cta="Honor the past, move forward" onClick={(e) => jumpToQuiz(e, 'situation_card_inherited')} />
                <SitCard icon="person_off" title="Done being everybody’s landlord" body="Hand us the keys, the tenant, and the headache. We close with renters in place — no evictions, no awkward conversations, no 60-day notices." cta="Get your weekends back" onClick={(e) => jumpToQuiz(e, 'situation_card_landlord')} />
                <SitCard icon="construction" title="A house you can’t afford to fix" body="Fire damage, foundation cracks, code violations, a kitchen frozen in 1978 — none of it scares us, and none of it lowers our offer the way a retail buyer would." cta="Sell it exactly as it sits" onClick={(e) => jumpToQuiz(e, 'situation_card_repairs')} />
                <SitCard icon="schedule_send" title="Foreclosure, divorce, or a fast move" body="When life forces a fast decision, we move at your speed and protect your privacy. 14-day closings with title partners who already know our paperwork." cta="Close on your timeline" onClick={(e) => jumpToQuiz(e, 'situation_card_life_event')} />
                <SitCard icon="landscape" title="Land or lots draining your wallet" body="Vacant lots, ag parcels, that infill piece your uncle left you — if it’s costing you taxes every year and earning you nothing, we’ll take it off your books." cta="Stop paying for nothing" onClick={(e) => jumpToQuiz(e, 'situation_card_land')} />
              </div>
            </>
          )}
        </div>
      </section>

      {isTaxLanding && (
        <section className="block tax-about-section" id="about" data-track-section="tax_about_team">
          <div className="container">
            <div className="tax-about-grid">
              <div className="tax-about-copy">
                <div className="section-eyebrow">About Saving KC</div>
                <h2 className="section-title">Local people helping KC owners get unstuck.</h2>
                <p>
                  You are not calling a national call center or a lead buyer. You are reaching Ernest, Casey, and a Kansas City team that works directly with owners facing back taxes, inherited homes, repairs, liens, and tight timelines.
                </p>
                <p>
                  Our job is to give you a clear number, explain the title and tax payoff path, and let you decide without pressure. If a cash sale is not the right move, we will say that plainly.
                </p>
              </div>
              <div className="tax-team-panel">
                <TeamTrustCard initials="ED" name="Ernest Dodson" role="Owner · Local KC homebuyer" />
                <TeamTrustCard initials="CD" name="Casey Davis" role="Seller follow-up · Fast response" />
                <div className="tax-about-proof">
                  <strong>100+ KC homeowners helped</strong>
                  <span>11+ years in the Kansas City market</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ MID CTA ============ */}
      <section className="block" data-track-section="mid_cta">
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
                <a href="#quiz" className="btn-secondary" onClick={(e) => jumpToQuiz(e, 'mid_page_offer_cta')}>
                  See My Number
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
      <section className="block" data-track-section="service_area">
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
      <section className="block" id="reviews" data-track-section="reviews">
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
      <section className="block" id="faq" data-track-section="faq">
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
                  onClick={() => {
                    if (openFaq !== i) {
                      firePpcTrackingEvent('faq_opened', {
                        faq_index: i,
                        faq_question: faq.q,
                        ...formContextRef.current,
                      })
                    }
                    setOpenFaq(openFaq === i ? null : i)
                  }}
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
      <section className="block" data-track-section="final_cta">
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
              onClick={(e) => jumpToQuiz(e, 'final_offer_cta')}
            >
              Get My Free Offer Estimate
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

function SitCard({
  icon,
  title,
  body,
  cta,
  onClick,
}: {
  icon: string
  title: string
  body: string
  cta: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <a href="#quiz" className="sit-card" onClick={onClick}>
      <div className="sit-icon">
        <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>{icon}</span>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      <span className="sit-link">{cta}</span>
    </a>
  )
}

function TaxTimelineStep({
  number,
  label,
  title,
  body,
  tone,
}: {
  number: string
  label: string
  title: string
  body: string
  tone: string
}) {
  return (
    <div className={`tax-timeline-step ${tone}`}>
      <div className="tax-timeline-circle">{number}</div>
      <div className="tax-timeline-label">{label}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}

function TaxStageColumn({
  icon,
  stage,
  kicker,
  body,
  points,
  cta,
  onClick,
}: {
  icon: string
  stage: string
  kicker: string
  body: string
  points: string[]
  cta: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}) {
  return (
    <a href="#quiz" className="tax-stage-column" onClick={onClick}>
      <div className="tax-stage-header">
        <span className="material-symbols-outlined" aria-hidden>{icon}</span>
        <h3>{stage}</h3>
      </div>
      <p className="tax-stage-kicker">{kicker}</p>
      <p className="tax-stage-body">{body}</p>
      <ul>
        {points.map((point) => (
          <li key={point}>
            <span className="material-symbols-outlined" aria-hidden>check_circle</span>
            {point}
          </li>
        ))}
      </ul>
      <span className="tax-stage-link">{cta}</span>
    </a>
  )
}

function TeamTrustCard({ initials, name, role }: { initials: string; name: string; role: string }) {
  return (
    <div className="tax-team-card">
      <div className="tax-team-avatar">{initials}</div>
      <div>
        <h3>{name}</h3>
        <p>{role}</p>
      </div>
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
    a: "Fastest we've done is 18 days from offer to close on a pre-DLT property. Typical is 21–30 days, but we'll close on your timeline — including if you need 60–90 days to find your next place.",
  },
  {
    q: 'Why should I trust Saving KC over the other "cash for houses" guys?',
    a: "Fair question. Three things: (1) We're a real KC business with 11 years here, not a national lead-buyer reselling your info. (2) We close most of what we put under contract — we don't tie up your property and back out. (3) We'll give you references to homeowners we've closed with in the last 90 days. Call them before you sign anything.",
  },
]
