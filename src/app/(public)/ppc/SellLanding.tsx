'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureAttribution, getAttribution } from '@/lib/ppc/attribution'
import { fireConversion, fireFormError, firePpcTrackingEvent } from '@/lib/ppc/conversions'
import { getPpcSessionContext } from '@/lib/ppc/tracking-client'
import { buildGoogleAdsLeadsUserData } from '@/lib/ppc/browser-enhanced-conversions'
import { AddressAutocomplete } from './AddressAutocomplete'

type LandingVariant = 'general' | 'tax' | 'redemption' | 'excess-proceeds'

type Situation =
  | 'tax-delinquent'
  | 'inherited'
  | 'tired-landlord'
  | 'condition'
  | 'life-event'
  | 'redemption-window'
  | 'redemption-not-sure'
  | 'excess-proceeds'
  | 'excess-not-sure'
  | 'other'

type Timeline = 'asap' | '60-days' | 'flexible' | 'exploring'
type Condition =
  | 'good'
  | 'needs-work'
  | 'major-repair'
  | 'vacant'
  | 'redeem-payoff'
  | 'redeem-title'
  | 'redeem-cash'
  | 'redeem-sell'
  | 'proceeds-claim'
  | 'proceeds-heirs'
  | 'proceeds-liens'
  | 'proceeds-cash-now'
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

type RadioTile<T extends string> = {
  value: T
  icon?: string
  label: string
}

type DecisionRowContent = {
  tone: 'brand' | 'amber' | 'green'
  icon: string
  stage: string
  title: string
  body: string
  ifLabel: string
  ifValue: string
  thenLabel: string
  thenValue: string
  cta: string
}

type TestimonialContent = {
  initials: string
  name: string
  meta: string
  quote: string
  result?: string
}

type SpecializedLandingContent = {
  rootClass: string
  navJumpLabel: string
  heroEyebrow: string
  heroTitle: string
  heroAccent: string
  heroSummary: string
  heroBullets: Array<{ strong: string; muted?: string }>
  toolIcon: string
  toolEyebrow: string
  toolTitle: string
  toolSub: string
  step1Question: string
  situationTiles: Array<RadioTile<Situation>>
  auctionQuestion: string
  timelineQuestion: string
  timelineTiles: Array<RadioTile<Timeline>>
  conditionQuestion: string
  conditionTiles: Array<RadioTile<Condition>>
  nextOfferLabel: string
  readyText: string
  midCtaTitle: string
  midCtaAccent: string
  midCtaBody: string
  midCtaLabel: string
  midStats: Array<{ number: string; label: string }>
  timelineEyebrow: string
  timelineTitle: string
  timelineAccent: string
  timelineSub: string
  timelineSteps: Array<[string, string, string, string]>
  decisionEyebrow: string
  decisionTitle: string
  decisionAccent: string
  decisionSub: string
  decisionTop: string
  decisionRows: DecisionRowContent[]
  guaranteeTitle: string
  guaranteeAccent: string
  guaranteeBody: string
  guaranteeChecks: string[]
  teamBody: string
  teamProof: string[]
  ernestBody: string
  caseyBody: string
  testimonials: TestimonialContent[]
  reviewsSub: string
  finalTitlePrefix: string
  finalAccent: string
  finalTitleSuffix: string
  finalBody: string
  finalCtaLabel: string
  faqs: Array<{ q: string; a: string }>
}

type SellLandingProps = {
  phoneDisplay: string
  phoneTel: string
  showBookingCta?: boolean
  variant?: LandingVariant
}

type YouTubePlayer = {
  playVideo: () => void
  destroy: () => void
  getCurrentTime?: () => number
  getDuration?: () => number
}

type YouTubePlayerEvent = {
  target: YouTubePlayer
}

type YouTubeStateEvent = YouTubePlayerEvent & {
  data: number
}

type YouTubeNamespace = {
  Player: new (
    element: string | HTMLIFrameElement,
    options: { events?: { onReady?: (event: YouTubePlayerEvent) => void; onStateChange?: (event: YouTubeStateEvent) => void } },
  ) => YouTubePlayer
}

declare global {
  interface Window {
    YT?: YouTubeNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const VIDEO_TESTIMONIALS = [
  {
    id: 'bZyZYbI0sg4',
    title: 'Seller story: a cleaner way out',
    runtime: '1:08',
    thumbnail: '/ppc/seller-story-cleaner-way-out.webp',
    url: 'https://www.youtube.com/embed/bZyZYbI0sg4',
  },
  {
    id: 'eA55Ehd17mI',
    title: 'Seller story: local help in KC',
    runtime: '1:29',
    thumbnail: '/ppc/seller-story-local-help.webp',
    url: 'https://www.youtube.com/embed/eA55Ehd17mI',
  },
]

const YOUTUBE_STATE = {
  ended: 0,
  playing: 1,
  paused: 2,
} as const

type DecisionRowClick = {
  stage: string
  title: string
  cta: string
  section: 'problems' | 'stages'
  position: number
}

function slugifyId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item'
}

function stableEventId(...parts: string[]): string {
  return parts.map(slugifyId).filter(Boolean).join('__')
}

function pageVariantKey(variant: SellLandingProps['variant']): 'ppc_tax' | 'ppc_general' | 'ppc_redemption' | 'ppc_excess_proceeds' {
  if (variant === 'tax') return 'ppc_tax'
  if (variant === 'redemption') return 'ppc_redemption'
  if (variant === 'excess-proceeds') return 'ppc_excess_proceeds'
  return 'ppc_general'
}

function sectionFromClickLocation(clickLocation: string): string {
  if (clickLocation.includes('nav') || clickLocation.includes('topbar')) return 'navigation'
  if (clickLocation.includes('hero')) return 'hero'
  if (clickLocation.includes('mid')) return 'mid_cta'
  if (clickLocation.includes('final') || clickLocation.includes('bottom')) return 'final_cta'
  if (clickLocation.includes('footer')) return 'footer'
  if (clickLocation.includes('problem')) return 'problems'
  if (clickLocation.includes('tax_decision')) return 'stages'
  return clickLocation.replace(/_/g, '-')
}

function navLabelForTarget(target: string, isSpecializedLanding: boolean): string {
  const labels: Record<string, string> = isSpecializedLanding
    ? {
      quiz: 'Start',
      timeline: 'Steps',
      stages: 'Issues',
      team: 'Team',
      faq: 'FAQ',
      'video-testimonials': 'Reviews',
    }
    : {
      quiz: 'Start',
      how: 'Steps',
      problems: 'Issues',
      about: 'Team',
      faq: 'FAQ',
      'video-testimonials': 'Reviews',
    }
  return labels[target] || target.replace(/-/g, ' ')
}

function initialQuizState(variant: LandingVariant): QuizState {
  if (variant === 'redemption') return { ...EMPTY_STATE, situation: 'redemption-window' }
  if (variant === 'excess-proceeds') return { ...EMPTY_STATE, situation: 'excess-proceeds' }
  return { ...EMPTY_STATE, situation: 'tax-delinquent' }
}

export function SellLanding({ phoneDisplay, phoneTel, showBookingCta = false, variant = 'general' }: SellLandingProps) {
  const specialized = variant === 'general' ? null : SPECIALIZED_LANDING_CONTENT[variant]
  const isSpecializedLanding = Boolean(specialized)
  const variantKey = pageVariantKey(variant)
  const totalSteps = 4
  const finalStep = 4
  const [step, setStep] = useState<FormStep>(1)
  const [state, setState] = useState<QuizState>(() => initialQuizState(variant))
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
  const addressCaptureKeyRef = useRef<string | null>(null)
  const potentialLeadKeyRef = useRef<string | null>(null)
  const contactFieldTrackedRef = useRef<Set<string>>(new Set())
  const viewedSectionsRef = useRef<Set<string>>(new Set())
  const scrollDepthsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    captureAttribution()
    firePpcTrackingEvent('ppc_visit_started', {
      ppc_phone_display: phoneDisplay,
      ppc_phone_tel: phoneTel,
      landing_page: window.location.href,
      page_title: document.title,
      total_steps: totalSteps,
    })
    firePpcTrackingEvent('skc_phone_number_selected', {
      ppc_phone_display: phoneDisplay,
      ppc_phone_tel: phoneTel,
      landing_page: window.location.href,
      total_steps: totalSteps,
    })
  }, [phoneDisplay, phoneTel, totalSteps])

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
      const { sessionId, visitorId } = getPpcSessionContext()
      await fetch('/api/leads/ppc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: currentStep,
          ...partial,
          attribution,
          sessionId: sessionId ?? undefined,
          visitorId: visitorId ?? undefined,
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

  const commonFunnelPayload = useCallback(() => ({
    form_step: step,
    total_steps: totalSteps,
    situation: state.situation || undefined,
    timeline: state.timeline || undefined,
    condition: state.condition || undefined,
    auctionStatus: state.auctionStatus || undefined,
  }), [
    state.auctionStatus,
    state.condition,
    state.situation,
    state.timeline,
    step,
    totalSteps,
  ])

  useEffect(() => {
    const thresholds = [25, 50, 75, 90]

    const measure = () => {
      const doc = document.documentElement
      const body = document.body
      const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight)
      const viewportHeight = window.innerHeight || doc.clientHeight
      const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0
      const scrollable = scrollHeight - viewportHeight

      if (scrollable <= 200 || scrollTop < 10) return

      const depth = Math.min(100, Math.round(((scrollTop + viewportHeight) / scrollHeight) * 100))
      thresholds.forEach((threshold) => {
        if (depth < threshold || scrollDepthsRef.current.has(threshold)) return
        scrollDepthsRef.current.add(threshold)
        firePpcTrackingEvent('scroll_depth_reached', {
          ...commonFunnelPayload(),
          scroll_depth: threshold,
          percent_scrolled: depth,
        })
      })
    }

    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [commonFunnelPayload])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    const sectionIds = isSpecializedLanding
      ? ['quiz', 'timeline', 'stages', 'team', 'video-testimonials', 'reviews', 'faq']
      : ['quiz', 'how', 'problems', 'about', 'video-testimonials', 'reviews', 'faq']
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section))

    if (!sections.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const sectionId = entry.target.id
          if (!entry.isIntersecting || viewedSectionsRef.current.has(sectionId)) return
          viewedSectionsRef.current.add(sectionId)
          firePpcTrackingEvent('section_viewed', {
            ...commonFunnelPayload(),
            section_id: sectionId,
            section_name: sectionId.replace(/-/g, ' '),
          })
        })
      },
      { threshold: 0.25, rootMargin: '-10% 0px -35% 0px' },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [commonFunnelPayload, isSpecializedLanding])

  useEffect(() => {
    if (submitted || step !== finalStep) return

    const address = state.address.trim()
    if (address.length < 6) return

    const addressCaptureKey = [
      address,
      state.situation,
      state.timeline,
      state.condition,
      state.auctionStatus,
    ].join('|')
    if (addressCaptureKeyRef.current === addressCaptureKey) return

    const timer = window.setTimeout(async () => {
      try {
        const attribution = getAttribution()
        const { sessionId, visitorId } = getPpcSessionContext()
        const r = await fetch('/api/leads/ppc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'address_capture',
            step: finalStep,
            address,
            addressSource: 'typed',
            situation: state.situation || undefined,
            timeline: state.timeline || undefined,
            condition: state.condition || undefined,
            auctionStatus: state.auctionStatus || undefined,
            attribution,
            sessionId: sessionId ?? undefined,
            visitorId: visitorId ?? undefined,
          }),
        })
        if (r.ok) addressCaptureKeyRef.current = addressCaptureKey
      } catch {
        // best-effort only; the actual form can still submit normally.
      }
    }, 900)

    return () => window.clearTimeout(timer)
  }, [
    finalStep,
    state.address,
    state.auctionStatus,
    state.condition,
    state.situation,
    state.timeline,
    step,
    submitted,
  ])

  useEffect(() => {
    if (submitted || step !== finalStep) return

    const address = state.address.trim()
    const name = state.name.trim()
    const phone = state.phone.trim()
    const email = state.email.trim().toLowerCase()
    const phoneDigits = phone.replace(/\D/g, '')
    const hasPhoneOrEmail = phoneDigits.length >= 10 || email.includes('@')
    const hasSubmitFields = Boolean(address && name && phoneDigits.length >= 10 && email.includes('@'))

    if (!address || !hasPhoneOrEmail || hasSubmitFields) return

    const potentialLeadKey = [address, name, phoneDigits, email].join('|')
    if (potentialLeadKeyRef.current === potentialLeadKey) return

    const timer = window.setTimeout(async () => {
      try {
        const attribution = getAttribution()
        const { sessionId, visitorId } = getPpcSessionContext()
        const r = await fetch('/api/leads/ppc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'potential',
            step: finalStep,
            address,
            addressSource: 'typed',
            situation: state.situation,
            timeline: state.timeline,
            condition: state.condition,
            auctionStatus: state.auctionStatus || undefined,
            contact: { name, phone, email },
            attribution,
            sessionId: sessionId ?? undefined,
            visitorId: visitorId ?? undefined,
          }),
        })
        const json = await r.json().catch(() => null)
        if (r.ok && json?.ok) {
          potentialLeadKeyRef.current = potentialLeadKey
          if (json.manifestId) setManifestId(json.manifestId)
          if (json.leadId) setLeadId(json.leadId)
        }
      } catch {
        // best-effort only; final submit still owns notifications and conversion.
      }
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [
    finalStep,
    state.address,
    state.auctionStatus,
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
        const { sessionId, visitorId } = getPpcSessionContext()
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
            sessionId: sessionId ?? undefined,
            visitorId: visitorId ?? undefined,
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

  const validateTimeline = (formStep: FormStep) => {
    if (state.timeline) return true
    trackFormError('Answer this question to continue.', 'timeline', formStep)
    return false
  }

  const validateCondition = (formStep: FormStep) => {
    if (state.condition) return true
    trackFormError('Answer this question to continue.', 'condition', formStep)
    return false
  }

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
      if (isSpecializedLanding) {
        if (!state.auctionStatus) {
          trackFormError('Answer this question to continue.', 'auctionStatus', 2)
          return
        }
        postPartial(2, {
          situation: state.situation,
          auctionStatus: state.auctionStatus,
        })
      } else {
        if (!validateTimeline(2)) return
        postPartial(2, {
          situation: state.situation,
          timeline: state.timeline,
        })
      }
    }
    if (toStep === 4) {
      const qualificationStep = 3
      if (isSpecializedLanding) {
        if (!validateTimelineAndCondition(qualificationStep)) return
      } else {
        if (!validateTimeline(2)) return
        if (!validateCondition(qualificationStep)) return
      }
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
    firePpcTrackingEvent('form_step_completed', {
      ...commonFunnelPayload(),
      completed_step: step,
      next_step: toStep,
      form_status: toStep === finalStep ? 'qualified' : 'in_progress',
    })
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
      const { sessionId, visitorId } = getPpcSessionContext()
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
          sessionId: sessionId ?? undefined,
          visitorId: visitorId ?? undefined,
        }),
      })
      const json = await r.json()
      if (!r.ok || !json?.ok) throw new Error(json?.error ?? 'Submit failed')
      if (!json.conversionSuppressed && !json.notificationsSkipped && !json.test) {
        const leadsUserData = await buildGoogleAdsLeadsUserData({
          email: state.email,
          phone: state.phone,
        })

        fireConversion('lead_submitted', {
          event_id: typeof json.conversionEventId === 'string' ? json.conversionEventId : undefined,
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
          leadsUserData: leadsUserData ?? undefined,
        })
      }
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

  const trackContactFieldStarted = <K extends keyof QuizState>(key: K, value: QuizState[K]) => {
    if (key !== 'address' && key !== 'name' && key !== 'phone' && key !== 'email') return
    if (contactFieldTrackedRef.current.has(key)) return

    const cleaned = String(value || '').trim()
    const enoughSignal = key === 'phone'
      ? cleaned.replace(/\D/g, '').length >= 3
      : key === 'email'
        ? cleaned.length >= 3
        : cleaned.length >= 2
    if (!enoughSignal) return

    contactFieldTrackedRef.current.add(key)
    firePpcTrackingEvent('contact_field_started', {
      form_step: finalStep,
      field_name: key,
      field_group: 'contact',
      has_address: key === 'address' || Boolean(state.address.trim()),
      has_name: key === 'name' || Boolean(state.name.trim()),
      has_phone: key === 'phone' || state.phone.replace(/\D/g, '').length >= 3,
      has_email: key === 'email' || Boolean(state.email.trim()),
      situation: state.situation || undefined,
      timeline: state.timeline || undefined,
      condition: state.condition || undefined,
      auctionStatus: state.auctionStatus || undefined,
    })
  }

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
        form_step: isSpecializedLanding ? 3 : 2,
        situation: state.situation || undefined,
        timeline: value,
      })
    }
    if (key === 'condition') {
      firePpcTrackingEvent('condition_selected', {
        form_step: 3,
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
    trackContactFieldStarted(key, value)
  }

  const trackCtaClick = (clickLocation: string, ctaLabel: string, ctaTarget = 'quiz') => {
    const destination = ctaTarget.startsWith('#') ? ctaTarget : `#${ctaTarget}`
    firePpcTrackingEvent('cta_click', {
      ...commonFunnelPayload(),
      cta_id: stableEventId(variantKey, 'cta', clickLocation, ctaLabel || ctaTarget),
      click_location: clickLocation,
      placement: clickLocation,
      section: sectionFromClickLocation(clickLocation),
      cta_label: ctaLabel,
      cta_target: ctaTarget,
      destination,
    })
  }
  const trackNavClick = (id: string, clickLocation: string) => {
    const navLabel = navLabelForTarget(id, isSpecializedLanding)
    firePpcTrackingEvent('nav_click', {
      ...commonFunnelPayload(),
      nav_id: stableEventId(variantKey, 'nav', clickLocation, id),
      nav_target: id,
      nav_label: navLabel,
      click_location: clickLocation,
      placement: clickLocation,
      section: 'navigation',
      destination: `#${id}`,
    })
  }
  const scrollToQuiz = () => document.getElementById('quiz')?.scrollIntoView({ behavior: 'smooth' })
  const handleQuizCta = (clickLocation: string, ctaLabel: string) => {
    trackCtaClick(clickLocation, ctaLabel)
    scrollToQuiz()
  }
  const handleDecisionRowClick = (row: DecisionRowClick) => {
    firePpcTrackingEvent('show_me_clicked', {
      ...commonFunnelPayload(),
      item_id: stableEventId(variantKey, row.section, row.stage, row.title),
      item_label: row.title,
      issue: row.stage,
      cta_label: row.cta,
      destination: '#quiz',
      section: row.section,
      placement: 'decision_row',
      position: row.position,
    })
    scrollToQuiz()
  }
  const scrollToId = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    trackNavClick(id, mobileMenuOpen ? 'mobile_nav' : 'top_nav')
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }
  const trackPhoneClick = (clickLocation: string) => {
    firePpcTrackingEvent('phone_click', {
      phone_number: phoneTel,
      phone_display: phoneDisplay,
      cta_id: stableEventId(variantKey, 'phone', clickLocation),
      cta_label: `Call ${phoneDisplay}`,
      click_location: clickLocation,
      placement: clickLocation,
      section: sectionFromClickLocation(clickLocation),
      destination: `tel:${phoneTel}`,
    })
  }
  const faqs = specialized?.faqs ?? FAQS
  const isAuctionStep = isSpecializedLanding && step === 2
  const isTimelineStep = isSpecializedLanding ? step === 3 : step === 2
  const isConditionStep = !isSpecializedLanding && step === 3
  const timelineNextStep: FormStep = isSpecializedLanding ? 4 : 3
  const stepLabel = step === finalStep
    ? '15 seconds to finish'
    : isAuctionStep
      ? '10 seconds'
      : isTimelineStep
        ? '20 seconds'
        : isConditionStep
          ? '15 seconds'
        : '30 seconds'

  return (
    <div className={`skc-sell ${isSpecializedLanding ? `tax-landing ${specialized?.rootClass ?? ''}` : ''}`}>
      {/* ============ TOP BAR ============ */}
      <div className="topbar">
        <div className="container topbar-inner">
          <a href="#quiz" className="logo" onClick={scrollToId('quiz')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/skc-logo.png" alt="Saving KC Homebuyers" className="topbar-logo" width={489} height={141} />
          </a>
          <nav className="nav-links" aria-label="primary">
            {isSpecializedLanding ? (
              <>
                <a href="#timeline" onClick={scrollToId('timeline')}>Steps</a>
                <a href="#stages" onClick={scrollToId('stages')}>Issues</a>
                <a href="#team" onClick={scrollToId('team')}>Team</a>
              </>
            ) : (
              <>
                <a href="#how" onClick={scrollToId('how')}>Steps</a>
                <a href="#problems" onClick={scrollToId('problems')}>Issues</a>
                <a href="#about" onClick={scrollToId('about')}>Team</a>
              </>
            )}
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#video-testimonials" onClick={scrollToId('video-testimonials')}>Reviews</a>
          </nav>
          <div className={`topbar-right ${navJumpVisible ? 'has-jump' : ''}`}>
            <div className="topbar-trust">
              <span className="stars">★★★★★</span>
              <span><strong>100+</strong> Owners helped</span>
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
                {specialized?.navJumpLabel ?? 'Get My Offer'}
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
            {isSpecializedLanding ? (
              <>
                <a href="#timeline" onClick={scrollToId('timeline')}>Steps</a>
                <a href="#stages" onClick={scrollToId('stages')}>Issues</a>
                <a href="#team" onClick={scrollToId('team')}>Team</a>
              </>
            ) : (
              <>
                <a href="#how" onClick={scrollToId('how')}>Steps</a>
                <a href="#problems" onClick={scrollToId('problems')}>Issues</a>
                <a href="#about" onClick={scrollToId('about')}>Team</a>
              </>
            )}
            <a href="#faq" onClick={scrollToId('faq')}>FAQ</a>
            <a href="#video-testimonials" onClick={scrollToId('video-testimonials')}>Reviews</a>
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
                <span className="dot"></span> {specialized?.heroEyebrow ?? 'Kansas City • MO + KS'}
              </div>
              {specialized ? (
                <>
                  <h1>{specialized.heroTitle} <span className="accent">{specialized.heroAccent}</span></h1>
                  <p className="tax-hero-summary">
                    {specialized.heroSummary}
                  </p>
                  <div className="fresh-start">
                    <span className="fresh-start-icon material-symbols-outlined" aria-hidden>{specialized.toolIcon}</span>
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
                {(specialized?.heroBullets ?? [
                  { strong: '$0 due before you sell.' },
                  { strong: '100% private.', muted: 'No yard signs. No open houses.' },
                  { strong: 'Close in 7-60 days', muted: '- you pick the day.' },
                  { strong: 'Back taxes paid at closing.' },
                ]).map((item) => (
                  <li key={`${item.strong}-${item.muted ?? ''}`}>
                    <span className="check">✓</span>
                    <span>
                      <strong>{item.strong}</strong>
                      {item.muted && <span className="muted-inline"> {item.muted}</span>}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="hero-trust-row">
                <span className="stars">★★★★★</span>
                <span className="trust-text">
                  <strong>4.9/5</strong> from <strong>100+ Owners helped</strong>
                </span>
                <span className="trust-text">
                  • <strong>11 years</strong> in the KC market
                </span>
              </div>
            </div>

            <div className="hero-form">
            <div className="tool-card" ref={toolCardRef}>
              <span className="tool-eyebrow">
                <span className="material-symbols-outlined" aria-hidden>{specialized?.toolIcon ?? 'bolt'}</span>
                {specialized?.toolEyebrow ?? 'Start here'}
              </span>
              <h2>{specialized?.toolTitle ?? 'Get Your Cash Offer in 1 hour.'}</h2>
              <p className="tool-sub">
                {specialized?.toolSub ?? 'Get a cash-offer range based on your property location, condition, and timeline in less than 1 hour.'}
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
                      <span className="btn-label">Book a 15-min Call</span>
                      <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                    </button>
                  )}
                </div>
              ) : step === 1 ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field form-field-prominent">
                    <span className="field-label">
                      {specialized?.step1Question ?? "What's your situation?"}
                    </span>
                    {specialized ? (
                      <div className={`radio-group ${specialized.situationTiles.length === 2 ? 'yesno' : 'three-col'}`}>
                        {specialized.situationTiles.map(({ value, icon, label }) => (
                          <button
                            key={value}
                            type="button"
                            className={`radio-tile ${state.situation === value ? 'selected' : ''}`}
                            onClick={() => select('situation', value)}
                          >
                            {icon && <span className="material-symbols-outlined" aria-hidden>{icon}</span>}
                            {label}
                          </button>
                        ))}
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
                    <span className="btn-label">Next</span>
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
                    <span className="field-label">{specialized?.auctionQuestion ?? 'Has your home been sold at auction?'}</span>
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
                    <span className="btn-label">Next</span>
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                </div>
              ) : isTimelineStep ? (
                <div style={{ marginTop: 18 }}>
                  <div className={`form-field ${!isSpecializedLanding ? 'form-field-prominent' : ''}`}>
                    <label>{specialized?.timelineQuestion ?? 'How soon do you need to sell?'}</label>
                    <div className={`radio-group ${!isSpecializedLanding ? 'prominent-choices' : ''}`}>
                      {(specialized?.timelineTiles ?? TIMELINE_TILES).map(({ value, label }) => (
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
                  {isSpecializedLanding && (
                    <div className="form-field">
                      <label>{specialized?.conditionQuestion ?? 'What shape is the property in?'}</label>
                      <div className="radio-group">
                        {(specialized?.conditionTiles ?? CONDITION_TILES).map(({ value, icon, label }) => (
                          <button
                            key={value}
                            type="button"
                            className={`radio-tile ${state.condition === value ? 'selected' : ''}`}
                            onClick={() => select('condition', value)}
                          >
                            {icon && <span className="material-symbols-outlined" aria-hidden>{icon}</span>}
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {error && <p style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
                  <button type="button" className="btn-continue" onClick={() => advance(timelineNextStep)}>
                    <span className="btn-label">{specialized?.nextOfferLabel ?? 'Next'}</span>
                    <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                  </button>
                </div>
              ) : isConditionStep ? (
                <div style={{ marginTop: 18 }}>
                  <div className="form-field form-field-prominent">
                    <label>Condition of the property</label>
                    <div className="radio-group prominent-choices">
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
                  <button type="button" className="btn-continue" onClick={() => advance(4)}>
                    <span className="btn-label">See My Offer Range</span>
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
                    {specialized?.readyText ?? 'Cash-offer range ready — finish below to see it.'}
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
                    <span className="btn-label">{submitting ? 'Sending…' : 'Get My Custom Offer'}</span>
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

      <TaxTrustStrip />

      {specialized ? (
        <>
          <TaxFreshStartTimeline content={specialized} />
          <TaxDecisionRows content={specialized} onRowClick={handleDecisionRowClick} />
          <TaxGuarantee content={specialized} />
          <TaxTeamSection content={specialized} />
        </>
      ) : (
        <>
          <GeneralFreshStartTimeline />
          <GeneralProblemRows onRowClick={handleDecisionRowClick} />
          <GeneralPromise />
          <GeneralTeamSection />
        </>
      )}

      {/* ============ MID CTA ============ */}
      <section className="block">
        <div className="container">
          <div className="mid-cta">
            <div className="mid-cta-content">
              <h2>
                {specialized?.midCtaTitle ?? 'Every month you wait, this gets'}{' '}
                <span className="accent">{specialized?.midCtaAccent ?? 'harder, not cheaper.'}</span>
              </h2>
              <p>
                {specialized?.midCtaBody ?? 'Taxes grow. Repairs get worse. Empty houses get damaged. Bad tenants can cost more each month. Get a clear number today, then decide what is best for you.'}
              </p>
              <div className="mid-cta-actions">
                <a
                  href="#quiz"
                  className="btn-secondary"
                  onClick={(e) => {
                    e.preventDefault()
                    handleQuizCta('mid_page_cta', specialized?.midCtaLabel ?? 'Get My Number')
                  }}
                >
                  {specialized?.midCtaLabel ?? 'Get My Number'}
                  <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                </a>
                <a href={`tel:${phoneTel}`} className="btn-secondary" onClick={() => trackPhoneClick('mid_page_cta')}>
                  <span className="material-symbols-outlined" aria-hidden>call</span>
                  Call {phoneDisplay}
                </a>
              </div>
            </div>
            <div className="mid-cta-stat">
              {(specialized?.midStats ?? [
                { number: '$0', label: 'Needed before you sell' },
                { number: '7-60 days', label: 'You pick the closing day' },
              ]).map((stat) => (
                <div className="stat-box" key={`${stat.number}-${stat.label}`}>
                  <div className="num">{stat.number}</div>
                  <div className="label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <GeneralVideoTestimonials />

      {/* ============ TESTIMONIALS ============ */}
      <section className="block" id="reviews">
        <div className="container">
          <div className="section-eyebrow">Real fresh starts</div>
          <h2 className="section-title">
            {specialized ? (
              <>
                100+ KC neighbors. <span className="accent-green">All the way home.</span>
              </>
            ) : (
              <>
                100+ KC neighbors. <span className="accent-green">All the way home.</span>
              </>
            )}
          </h2>
          <p className="section-sub">
            {specialized?.reviewsSub ?? 'No actors. Real sellers, real house trouble, real closing-table outcomes.'}
          </p>

          <div className="testimonials featured-testimonials">
            {(specialized?.testimonials ?? TESTIMONIALS).map((testimonial) => (
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
                  onClick={() => {
                    const willOpen = openFaq !== i
                    setOpenFaq(willOpen ? i : null)
                    if (!willOpen) return
                    firePpcTrackingEvent('faq_opened', {
                      ...commonFunnelPayload(),
                      faq_id: stableEventId(variantKey, 'faq', String(i + 1), faq.q),
                      faq_index: i + 1,
                      faq_question: faq.q,
                      label: faq.q,
                      section: 'faq',
                      position: i + 1,
                    })
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
      <section className="block">
        <div className="container">
          <div className="final-cta">
            <h2>
              {specialized?.finalTitlePrefix ?? 'Stop wondering. '}
              <span className="accent">
                {specialized?.finalAccent ?? 'Get your cash offer in 1 hour.'}
              </span>
              {specialized?.finalTitleSuffix ?? ''}
            </h2>
            <p>
              {specialized?.finalBody ?? 'Tell us the address and what is going on. We will give you a real number. You can say yes or no.'}
            </p>
            <a
              href="#quiz"
              className="btn-secondary lg"
              onClick={(e) => {
                e.preventDefault()
                handleQuizCta('final_cta', specialized?.finalCtaLabel ?? 'Get My Cash Offer')
              }}
            >
              {specialized?.finalCtaLabel ?? 'Get My Cash Offer'}
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

function GeneralFreshStartTimeline() {
  return (
    <section className="block tax-timeline-section" id="how">
      <div className="container">
        <div className="section-eyebrow">How it works</div>
        <h2 className="section-title">
          Tell us the mess. <span className="accent-green">We bring a number.</span>
        </h2>
        <p className="section-sub">
          You do not need a perfect house. You do not need money to fix it. You only need the address and the truth.
        </p>

        <div className="tax-timeline">
          <div className="tax-timeline-rail" />
          {[
            ['1', 'Today', 'Tell us what is wrong', 'Taxes, repairs, a tenant, probate, or junk. Say it in plain words.'],
            ['2', '1 hour', 'Get a real cash number', 'We check the house, title, taxes, and repairs. Then we show you the math.'],
            ['3', 'Your day', 'Close and move on', 'Pick 7 days or 60 days. We close at title and pay the agreed costs.'],
          ].map(([day, label, title, body], index) => (
            <div className={`tax-timeline-step step-${index + 1}`} key={title}>
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

function GeneralProblemRows({ onRowClick }: { onRowClick: (row: DecisionRowClick) => void }) {
  const rows = [
    {
      tone: 'brand',
      icon: 'gavel',
      stage: 'Back taxes',
      title: 'Tax letters keep coming',
      body: 'Fees grow each month. The county may set a sale date.',
      ifLabel: 'What we can do',
      ifValue: 'We can pay the back taxes at closing if we buy the house.',
      thenLabel: 'You get',
      thenValue: <>A clear cash offer and a way out</>,
      cta: 'Show me',
    },
    {
      tone: 'amber',
      icon: 'family_history',
      stage: 'Inherited house',
      title: 'You got a house you did not ask for',
      body: 'Family may not agree. The house may need work. You may live far away.',
      ifLabel: 'What we can do',
      ifValue: 'We can buy it as-is and work with the probate path.',
      thenLabel: 'You get',
      thenValue: <>One clean closing for the family</>,
      cta: 'Show me',
    },
    {
      tone: 'green',
      icon: 'construction',
      stage: 'Tenant or repairs',
      title: 'The house is too much right now',
      body: 'The tenant will not leave, or the repairs cost more than you have.',
      ifLabel: 'What we can do',
      ifValue: 'We buy with tenants, junk, old stuff, and repairs still there.',
      thenLabel: 'You get',
      thenValue: <>No cleaning. No fixing. No showings.</>,
      cta: 'Start',
    },
  ]

  return (
    <section className="block tax-decision-section" id="problems">
      <div className="container">
        <div className="section-eyebrow">What kind of trouble is it?</div>
        <h2 className="section-title">
          Pick the problem. <span className="accent-green">We show the next step.</span>
        </h2>
        <p className="section-sub">
          Most sellers who call us are tired, stuck, or scared of what comes next. That is exactly who we help.
        </p>

        <div className="tax-decision-block">
          <div className="decision-top">
            You do not have to fix it first. <strong>We buy the hard houses.</strong>
          </div>
          <div className="decision-rows">
            {rows.map((row, index) => (
              <button
                type="button"
                className={`decision-row decision-card ${row.tone}`}
                key={row.stage}
                onClick={() => onRowClick({
                  stage: row.stage,
                  title: row.title,
                  cta: row.cta,
                  section: 'problems',
                  position: index + 1,
                })}
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

function GeneralPromise() {
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
              You do not have to <span className="accent-green">fix the house</span> first.
            </h2>
            <p>
              Take what you want and leave the rest. Tell us what is really going on. We will give you a number and explain it in plain English.
            </p>
          </div>
          <div className="guarantee-checks">
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No repairs</span>
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No cleaning</span>
            <span><span className="material-symbols-outlined" aria-hidden>check</span>No open houses</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function GeneralTeamSection() {
  return (
    <section className="block tax-team-section" id="about">
      <div className="container">
        <div className="tax-team">
          <div className="tax-team-copy">
            <div className="section-eyebrow">Who you&apos;ll talk to</div>
            <h2 className="section-title">Local KC people, not a call center.</h2>
            <p>
              You talk with Ernest Dodson and Casey Davis. We look at the house, taxes, title, repairs, and your time. Then we tell you what we can pay and when we can close. No pushy script.
            </p>
            <div className="tax-team-proof">
              <span><strong>11+</strong> years in KC</span>
              <span><strong>100+</strong> sellers helped</span>
              <span><strong>4.9</strong> Google rating</span>
            </div>
          </div>
          <div className="tax-team-cards" aria-label="Saving KC team">
            <article className="tax-team-card">
              <div className="tax-team-card-head">
                <div className="tax-team-photo">
                  <Image src="/ernest-profile.png" alt="Ernest Dodson" width={192} height={192} sizes="96px" />
                </div>
                <div>
                  <h3>Ernest Dodson</h3>
                  <p className="tax-team-title">Lead House Hunter</p>
                </div>
              </div>
              <p>Helps you understand the offer, the title path, and the cleanest way out.</p>
            </article>
            <article className="tax-team-card">
              <div className="tax-team-card-head">
                <div className="tax-team-photo">
                  <Image src="/casey.jpg" alt="Casey Davis" width={192} height={192} sizes="96px" />
                </div>
                <div>
                  <h3>Casey Davis</h3>
                  <p className="tax-team-title">Junior House Hunter</p>
                </div>
              </div>
              <p>Keeps follow-up simple, fast, and clear while your file moves to closing.</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}

function GeneralVideoTestimonials() {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const videoFrameRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
  const videoPlayers = useRef<Record<string, YouTubePlayer | null>>({})
  const initializingVideoIds = useRef<Set<string>>(new Set())
  const playerInitAttempts = useRef<Record<string, number>>({})
  const playerInitRetryTimers = useRef<number[]>([])
  const initializePlayersRef = useRef<() => void>(() => undefined)
  const pendingPlayVideoId = useRef<string | null>(null)
  const playRetryTimers = useRef<number[]>([])
  const videoProgressTimers = useRef<Record<string, number>>({})
  const videoProgressMilestones = useRef<Record<string, Set<number>>>({})
  const startedVideoIds = useRef<Set<string>>(new Set())

  const videoPayload = useCallback((video: typeof VIDEO_TESTIMONIALS[number], extras: Record<string, unknown> = {}) => {
    const position = VIDEO_TESTIMONIALS.findIndex((item) => item.id === video.id) + 1
    return {
      video_id: video.id,
      video_title: video.title,
      title: video.title,
      runtime: video.runtime,
      section: 'video-testimonials',
      placement: 'video-testimonials',
      position,
      destination: video.url,
      ...extras,
    }
  }, [])

  const trackVideoStartedOnce = useCallback((video: typeof VIDEO_TESTIMONIALS[number], trigger: string) => {
    if (startedVideoIds.current.has(video.id)) return
    startedVideoIds.current.add(video.id)
    firePpcTrackingEvent('video_started', videoPayload(video, {
      trigger,
      percent: 0,
      watch_percent: 0,
    }))
  }, [videoPayload])

  const clearPlayRetryTimers = useCallback(() => {
    playRetryTimers.current.forEach((timerId) => window.clearTimeout(timerId))
    playRetryTimers.current = []
  }, [])

  const clearPlayerInitRetryTimers = useCallback(() => {
    playerInitRetryTimers.current.forEach((timerId) => window.clearTimeout(timerId))
    playerInitRetryTimers.current = []
  }, [])

  const clearVideoProgressTimer = useCallback((videoId: string) => {
    const timer = videoProgressTimers.current[videoId]
    if (timer) window.clearInterval(timer)
    delete videoProgressTimers.current[videoId]
  }, [])

  const clearAllVideoProgressTimers = useCallback(() => {
    Object.keys(videoProgressTimers.current).forEach(clearVideoProgressTimer)
  }, [clearVideoProgressTimer])

  const resetVideoPlayers = useCallback(() => {
    Object.values(videoPlayers.current).forEach((player) => player?.destroy())
    videoPlayers.current = {}
    initializingVideoIds.current.clear()
    playerInitAttempts.current = {}
  }, [])

  const sendPlayCommand = useCallback((videoId: string) => {
    const player = videoPlayers.current[videoId]
    if (player) {
      player.playVideo()
      pendingPlayVideoId.current = null
      return
    }

    videoFrameRefs.current[videoId]?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
      'https://www.youtube.com',
    )
  }, [])

  const videoPercent = useCallback((player: YouTubePlayer): number => {
    const duration = player.getDuration?.() ?? 0
    const current = player.getCurrentTime?.() ?? 0
    if (!duration || duration <= 0 || !Number.isFinite(duration) || !Number.isFinite(current)) return 0
    return Math.max(0, Math.min(100, Math.round((current / duration) * 100)))
  }, [])

  const trackVideoMilestones = useCallback((video: typeof VIDEO_TESTIMONIALS[number], player: YouTubePlayer): number => {
    const percent = videoPercent(player)
    const sent = videoProgressMilestones.current[video.id] ?? new Set<number>()
    videoProgressMilestones.current[video.id] = sent

    ;([25, 50, 75] as const).forEach((threshold) => {
      if (percent < threshold || sent.has(threshold)) return
      sent.add(threshold)
      firePpcTrackingEvent(`video_progress_${threshold}` as const, videoPayload(video, {
        percent: threshold,
        watch_percent: percent,
      }))
    })

    return percent
  }, [videoPayload, videoPercent])

  const startVideoProgressTimer = useCallback((video: typeof VIDEO_TESTIMONIALS[number], player: YouTubePlayer) => {
    clearVideoProgressTimer(video.id)
    videoProgressTimers.current[video.id] = window.setInterval(() => {
      trackVideoMilestones(video, player)
    }, 2000)
  }, [clearVideoProgressTimer, trackVideoMilestones])

  const handleVideoStateChange = useCallback((video: typeof VIDEO_TESTIMONIALS[number], event: YouTubeStateEvent) => {
    const player = event.target
    if (event.data === YOUTUBE_STATE.playing) {
      trackVideoStartedOnce(video, 'youtube_state')
      startVideoProgressTimer(video, player)
      return
    }

    if (event.data === YOUTUBE_STATE.paused) {
      const percent = trackVideoMilestones(video, player)
      clearVideoProgressTimer(video.id)
      firePpcTrackingEvent('video_paused', videoPayload(video, {
        percent,
        watch_percent: percent,
      }))
      return
    }

    if (event.data === YOUTUBE_STATE.ended) {
      clearVideoProgressTimer(video.id)
      firePpcTrackingEvent('video_completed', videoPayload(video, {
        percent: 100,
        watch_percent: 100,
      }))
    }
  }, [
    clearVideoProgressTimer,
    startVideoProgressTimer,
    trackVideoMilestones,
    trackVideoStartedOnce,
    videoPayload,
  ])

  const initializePlayers = useCallback(() => {
    const YouTubePlayerConstructor = window.YT?.Player
    if (!YouTubePlayerConstructor) return

    VIDEO_TESTIMONIALS.forEach((video) => {
      const frame = videoFrameRefs.current[video.id]
      if (!frame || videoPlayers.current[video.id] || initializingVideoIds.current.has(video.id)) return

      initializingVideoIds.current.add(video.id)
      playerInitAttempts.current[video.id] = (playerInitAttempts.current[video.id] ?? 0) + 1
      new YouTubePlayerConstructor(`seller-video-player-${video.id}`, {
        events: {
          onReady: (event) => {
            videoPlayers.current[video.id] = event.target
            initializingVideoIds.current.delete(video.id)
            if (pendingPlayVideoId.current === video.id) {
              sendPlayCommand(video.id)
            }
          },
          onStateChange: (event) => handleVideoStateChange(video, event),
        },
      })

      if (playerInitAttempts.current[video.id] < 4) {
        const retryTimer = window.setTimeout(() => {
          if (videoPlayers.current[video.id]) return
          initializingVideoIds.current.delete(video.id)
          initializePlayersRef.current()
        }, 1200)
        playerInitRetryTimers.current.push(retryTimer)
      }
    })
  }, [handleVideoStateChange, sendPlayCommand])

  useEffect(() => {
    initializePlayersRef.current = initializePlayers
  }, [initializePlayers])

  useEffect(() => {
    return () => {
      clearPlayRetryTimers()
      clearPlayerInitRetryTimers()
      clearAllVideoProgressTimers()
      resetVideoPlayers()
    }
  }, [clearAllVideoProgressTimers, clearPlayerInitRetryTimers, clearPlayRetryTimers, resetVideoPlayers])

  useEffect(() => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady
    const handleReady = () => {
      previousReadyHandler?.()
      initializePlayers()
    }

    if (window.YT?.Player) {
      initializePlayers()
      return
    }

    window.onYouTubeIframeAPIReady = handleReady

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      document.head.appendChild(script)
    }

    return () => {
      if (window.onYouTubeIframeAPIReady === handleReady) {
        window.onYouTubeIframeAPIReady = previousReadyHandler
      }
    }
  }, [initializePlayers])

  const startVideo = useCallback((videoId: string) => {
    clearPlayRetryTimers()
    const video = VIDEO_TESTIMONIALS.find((item) => item.id === videoId)
    if (video) trackVideoStartedOnce(video, 'thumbnail')
    setActiveVideoId(videoId)
    pendingPlayVideoId.current = videoId

    sendPlayCommand(videoId)
    playRetryTimers.current = [120, 360, 700, 1100, 1700, 2500, 3600].map((delay) =>
      window.setTimeout(() => sendPlayCommand(videoId), delay),
    )
  }, [clearPlayRetryTimers, sendPlayCommand, trackVideoStartedOnce])

  return (
    <section id="video-testimonials" className="block video-testimonial-section" aria-labelledby="video-testimonials-title">
      <div className="container">
        <div className="video-testimonial-panel">
          <div className="section-eyebrow">Video testimonials</div>
          <h2 className="section-title" id="video-testimonials-title">
            Hear from sellers who <span className="accent-green">got unstuck.</span>
          </h2>
          <p className="section-sub">
            Two short stories from real people who needed a simple way to sell.
          </p>

          <div className="video-testimonial-grid">
            {VIDEO_TESTIMONIALS.map((video) => (
              <article className="video-testimonial-card" key={video.id}>
                <div className="video-frame">
                  <iframe
                    id={`seller-video-player-${video.id}`}
                    ref={(node) => {
                      videoFrameRefs.current[video.id] = node
                    }}
                    src={`${video.url}?enablejsapi=1&rel=0&playsinline=1`}
                    title={video.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                  {activeVideoId !== video.id && (
                    <button
                      className="video-thumbnail-button"
                      type="button"
                      data-video-url={video.url}
                      onPointerDown={(event) => {
                        if (event.button === 0) startVideo(video.id)
                      }}
                      onClick={() => startVideo(video.id)}
                      aria-label={`Play ${video.title}, ${video.runtime}`}
                    >
                      <Image
                        src={video.thumbnail}
                        alt=""
                        fill
                        sizes="(max-width: 980px) 90vw, 470px"
                        className="video-thumbnail-image"
                      />
                      <span className="video-duration-badge">{video.runtime}</span>
                      <span className="video-youtube-play" aria-hidden>
                        <span className="video-youtube-triangle" />
                      </span>
                    </button>
                  )}
                </div>
                <div className="video-card-label">
                  <span className="material-symbols-outlined" aria-hidden>play_circle</span>
                  <span className="video-card-title">{video.title}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
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

function TaxFreshStartTimeline({ content }: { content: SpecializedLandingContent }) {
  return (
    <section className="block tax-timeline-section" id="timeline">
      <div className="container">
        <div className="section-eyebrow">{content.timelineEyebrow}</div>
        <h2 className="section-title">
          {content.timelineTitle} <span className="accent-green">{content.timelineAccent}</span>
        </h2>
        <p className="section-sub">{content.timelineSub}</p>

        <div className="tax-timeline">
          <div className="tax-timeline-rail" />
          {content.timelineSteps.map(([day, label, title, body], index) => (
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

function TaxDecisionRows({
  content,
  onRowClick,
}: {
  content: SpecializedLandingContent
  onRowClick: (row: DecisionRowClick) => void
}) {
  return (
    <section className="block tax-decision-section" id="stages">
      <div className="container">
        <div className="section-eyebrow">{content.decisionEyebrow}</div>
        <h2 className="section-title">
          {content.decisionTitle} <span className="accent-green">{content.decisionAccent}</span>
        </h2>
        <p className="section-sub">{content.decisionSub}</p>

        <div className="tax-decision-block">
          <div className="decision-top">
            {content.decisionTop}
          </div>
          <div className="decision-rows">
            {content.decisionRows.map((row, index) => (
              <button
                type="button"
                className={`decision-row decision-card ${row.tone}`}
                key={row.stage}
                onClick={() => onRowClick({
                  stage: row.stage,
                  title: row.title,
                  cta: row.cta,
                  section: 'stages',
                  position: index + 1,
                })}
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

function TaxTeamSection({ content }: { content: SpecializedLandingContent }) {
  return (
    <section className="block tax-team-section" id="team">
      <div className="container">
        <div className="tax-team">
          <div className="tax-team-copy">
            <div className="section-eyebrow">Who you&apos;ll talk to</div>
            <h2 className="section-title">Local KC people, not a call center.</h2>
            <p>
              {content.teamBody}
            </p>
            <div className="tax-team-proof">
              {content.teamProof.map((proof) => (
                <span key={proof}>{proof}</span>
              ))}
            </div>
          </div>
          <div className="tax-team-cards" aria-label="Saving KC team">
            <article className="tax-team-card">
              <div className="tax-team-card-head">
                <div className="tax-team-photo">
                  <Image src="/ernest-profile.png" alt="Ernest Dodson" width={192} height={192} sizes="96px" />
                </div>
                <div>
                  <h3>Ernest Dodson</h3>
                  <p className="tax-team-title">Lead House Hunter</p>
                </div>
              </div>
              <p>{content.ernestBody}</p>
            </article>
            <article className="tax-team-card">
              <div className="tax-team-card-head">
                <div className="tax-team-photo">
                  <Image src="/casey.jpg" alt="Casey Davis" width={192} height={192} sizes="96px" />
                </div>
                <div>
                  <h3>Casey Davis</h3>
                  <p className="tax-team-title">Junior House Hunter</p>
                </div>
              </div>
              <p>{content.caseyBody}</p>
            </article>
          </div>
        </div>
      </div>
    </section>
  )
}

function TaxGuarantee({ content }: { content: SpecializedLandingContent }) {
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
              {content.guaranteeTitle} <span className="accent-green">{content.guaranteeAccent}</span>
            </h2>
            <p>
              {content.guaranteeBody}
            </p>
          </div>
          <div className="guarantee-checks">
            {content.guaranteeChecks.map((check) => (
              <span key={check}><span className="material-symbols-outlined" aria-hidden>check</span>{check}</span>
            ))}
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

const TESTIMONIALS: TestimonialContent[] = [
  {
    initials: 'JK',
    name: 'Jerome K.',
    meta: 'Jackson County, MO',
    result: 'Closed fast',
    quote: '"I was close to a tax sale. Other buyers stopped calling when they saw the title. Saving KC stayed with it and closed fast."',
  },
  {
    initials: 'RM',
    name: 'Renee M.',
    meta: 'Wyandotte County, KS',
    result: 'Inherited · 18 days',
    quote: '"I had a house from my dad and three years of taxes. Saving KC paid the taxes at closing. I got a fair check."',
  },
  {
    initials: 'SP',
    name: 'Sandra P.',
    meta: 'Clay County, MO',
    result: 'Probate sale',
    quote: '"My brother and I did not agree on the house. They kept it calm, talked to both of us, and got us to closing."',
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

const SPECIALIZED_LANDING_CONTENT: Record<Exclude<LandingVariant, 'general'>, SpecializedLandingContent> = {
  tax: {
    rootClass: 'tax-variant',
    navJumpLabel: 'Start Fresh',
    heroEyebrow: 'Tax-delinquent specialists · KC metro',
    heroTitle: 'Behind on property taxes',
    heroAccent: '& want to sell?',
    heroSummary: 'Back taxes, penalties, county deadlines, and letters you do not want to open can make the house feel like a clock is running. We help you see the real number, protect what equity is left, and move without repairs, agents, or public listing pressure.',
    heroBullets: [
      { strong: '$0 due before you sell.' },
      { strong: '100% private.', muted: 'No yard signs. No open houses.' },
      { strong: 'Close in 7-60 days', muted: '- you pick the day.' },
      { strong: 'Back taxes paid at closing.' },
    ],
    toolIcon: 'wb_sunny',
    toolEyebrow: 'Your fresh start starts here',
    toolTitle: 'Get My Cash Offer In 1 hour.',
    toolSub: "Four quick questions. Answer or don't.",
    step1Question: 'Are you behind on property taxes?',
    situationTiles: [
      { value: 'tax-delinquent', icon: 'warning', label: 'Yes' },
      { value: 'other', icon: 'check_circle', label: 'No / Not sure' },
    ],
    auctionQuestion: 'Has your home been sold at auction?',
    timelineQuestion: 'How soon would you like this behind you?',
    timelineTiles: TIMELINE_TILES,
    conditionQuestion: 'What shape is the property in?',
    conditionTiles: CONDITION_TILES,
    nextOfferLabel: 'See My Fresh-Start Number',
    readyText: 'Fresh-start number ready — finish below to see it.',
    midCtaTitle: 'Every month you wait,',
    midCtaAccent: 'the math gets worse.',
    midCtaBody: 'Interest compounds. Penalties stack. Auction dates lock. The number you can walk away with this week can be smaller next month. Get your real number now.',
    midCtaLabel: 'Start My Fresh Start',
    midStats: [
      { number: '$45K', label: 'Average walk-away cash' },
      { number: '18 days', label: 'Fastest pre-DLT close' },
    ],
    timelineEyebrow: 'Fresh start in 60 minutes',
    timelineTitle: 'Form today.',
    timelineAccent: 'Offer today.',
    timelineSub: 'Most "we buy houses" promises take weeks. Yours starts with a real number in the next hour.',
    timelineSteps: [
      ['1', 'Today', 'Tell us your story', '60 seconds. Four questions. We start the file right away.'],
      ['2', 'Today', 'Cash offer in hand', 'We check the tax pressure, title path, and walk you through the number.'],
      ['3', 'Closing day', 'Your fresh start', 'Check in hand. Back taxes paid. Title closed. You walk away clean.'],
    ],
    decisionEyebrow: 'Where are you in this?',
    decisionTitle: 'Find your stage.',
    decisionAccent: 'See your fresh start.',
    decisionSub: 'Three stages. Three different deadlines. Tap the one that feels closest.',
    decisionTop: "Whatever stage you're in, there's money on the table.",
    decisionRows: [
      {
        tone: 'brand',
        icon: 'gavel',
        stage: 'Pre-auction',
        title: '3+ years behind',
        body: 'You still own the house, but the county clock is getting louder.',
        ifLabel: 'Best move',
        ifValue: "Sell before the auction locks in someone else's timeline.",
        thenLabel: 'You walk away with',
        thenValue: 'Cash for the house · fresh start in 14 days',
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
        thenValue: 'Cash before the deadline closes',
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
        thenValue: 'Excess proceeds - found money',
        cta: 'Check',
      },
    ],
    guaranteeTitle: 'The',
    guaranteeAccent: 'no-catch promise.',
    guaranteeBody: 'The number we give you is the number you walk away with, minus payoffs and back taxes, every penny disclosed before you sign.',
    guaranteeChecks: ['No fees', 'No commissions', 'No obligation'],
    teamBody: 'You will talk with Ernest Dodson and Casey Davis from the Saving KC team. We know Jackson, Clay, Platte, Wyandotte, and Johnson County tax-sale timelines, and we keep the conversation private, direct, and pressure-free.',
    teamProof: ['11+ years in KC', '100+ homeowners helped', '4.9 Google rating'],
    ernestBody: 'Walks through the tax pressure, the title path, and the number so you know exactly where you stand.',
    caseyBody: 'Fast follow-up, clear next steps, and steady communication while the file moves toward closing.',
    testimonials: TAX_TESTIMONIALS,
    reviewsSub: 'No actors. Real sellers, real tax pressure, real closing-table outcomes.',
    finalTitlePrefix: 'Your ',
    finalAccent: 'fresh start',
    finalTitleSuffix: ' is one form away.',
    finalBody: '60 seconds. Four questions. Cash offer in an hour. Closing timeline built around title and your situation.',
    finalCtaLabel: 'Start My Fresh Start',
    faqs: TAX_FAQS,
  },
  redemption: {
    rootClass: 'redemption-variant',
    navJumpLabel: 'Check My Window',
    heroEyebrow: 'Redemption-window help · KC metro',
    heroTitle: 'Tax sale happened?',
    heroAccent: 'You may still have a move.',
    heroSummary: 'A tax sale does not always mean the story is over. If the redemption window is still open, timing matters. We help you understand the deadline, the payoff path, and whether selling before the window closes protects more of your equity.',
    heroBullets: [
      { strong: 'Deadline-aware review.', muted: 'Missouri and Kansas timelines are different.' },
      { strong: 'Private cash-offer option.', muted: 'No public listing or open houses.' },
      { strong: 'Title and payoff path explained.', muted: 'Plain English, no pressure.' },
      { strong: '$0 upfront to ask.' },
    ],
    toolIcon: 'timer',
    toolEyebrow: 'Check the redemption path',
    toolTitle: 'See Your Redemption Options In 1 hour.',
    toolSub: 'Four quick questions. We start with the deadline, then the address.',
    step1Question: 'Are you trying to redeem after a tax sale?',
    situationTiles: [
      { value: 'redemption-window', icon: 'timer', label: 'Yes, redemption window' },
      { value: 'redemption-not-sure', icon: 'help', label: 'Not sure / need help' },
    ],
    auctionQuestion: 'Did the tax sale already happen?',
    timelineQuestion: 'How close is the redemption deadline?',
    timelineTiles: [
      { value: 'asap', label: 'Under 30 days' },
      { value: '60-days', label: '30-90 days' },
      { value: 'flexible', label: 'More than 90 days' },
      { value: 'exploring', label: 'I do not know' },
    ],
    conditionQuestion: 'What help do you need first?',
    conditionTiles: [
      { value: 'redeem-payoff', icon: 'request_quote', label: 'Need payoff amount' },
      { value: 'redeem-title', icon: 'fact_check', label: 'Need title help' },
      { value: 'redeem-cash', icon: 'savings', label: 'Need cash to redeem' },
      { value: 'redeem-sell', icon: 'sell', label: 'Want to sell instead' },
    ],
    nextOfferLabel: 'Check My Redemption Path',
    readyText: 'Redemption review ready — finish below so we can check the property.',
    midCtaTitle: 'Every day matters when',
    midCtaAccent: 'a redemption clock is running.',
    midCtaBody: 'The deadline, payoff amount, title status, and county process decide your real options. Waiting can turn a fixable problem into a closed door.',
    midCtaLabel: 'Check My Window',
    midStats: [
      { number: '1 hour', label: 'Initial option review' },
      { number: '$0', label: 'Upfront to ask' },
    ],
    timelineEyebrow: 'Redemption path in 3 moves',
    timelineTitle: 'Deadline first.',
    timelineAccent: 'Options second.',
    timelineSub: 'We start with what can still be done, then show the cleanest route before time gets tighter.',
    timelineSteps: [
      ['1', 'Today', 'Tell us where it stands', 'Sale happened, deadline unknown, payoff unclear, or title confusing. Say what you know.'],
      ['2', 'Today', 'We check the moving parts', 'We review the address, county path, tax pressure, title risk, and whether a sale still makes sense.'],
      ['3', 'Your move', 'Redeem, sell, or walk away informed', 'You get a direct explanation and a cash-offer option if selling is the cleaner route.'],
    ],
    decisionEyebrow: 'Where are you stuck?',
    decisionTitle: 'Pick the blocker.',
    decisionAccent: 'We map the next move.',
    decisionSub: 'Redemption problems usually come down to deadline, payoff, title, or cash.',
    decisionTop: 'The sooner we know the deadline, the more options stay open.',
    decisionRows: [
      {
        tone: 'brand',
        icon: 'timer',
        stage: 'Deadline',
        title: 'I do not know how much time is left',
        body: 'The tax sale happened and every letter feels urgent.',
        ifLabel: 'First move',
        ifValue: 'Identify the deadline and whether the window is still open.',
        thenLabel: 'You get',
        thenValue: 'A clear next-step plan before time runs out',
        cta: 'Check',
      },
      {
        tone: 'amber',
        icon: 'request_quote',
        stage: 'Payoff',
        title: 'I do not know the real number',
        body: 'Taxes, fees, interest, and sale costs can be hard to untangle.',
        ifLabel: 'First move',
        ifValue: 'Estimate the payoff path and compare it to selling as-is.',
        thenLabel: 'You get',
        thenValue: 'A better decision than guessing',
        cta: 'Start',
      },
      {
        tone: 'green',
        icon: 'sell',
        stage: 'Sell',
        title: 'I may rather sell than redeem',
        body: 'If the math does not work, selling can protect what is left.',
        ifLabel: 'First move',
        ifValue: 'Get a private cash-offer option before the window closes.',
        thenLabel: 'You get',
        thenValue: 'A way out without listing pressure',
        cta: 'Show me',
      },
    ],
    guaranteeTitle: 'The',
    guaranteeAccent: 'deadline-aware promise.',
    guaranteeBody: 'We will not pretend every redemption file is simple. We tell you what looks possible, what looks risky, and what we can actually do before you sign anything.',
    guaranteeChecks: ['No upfront fee', 'No public listing', 'No obligation'],
    teamBody: 'You will talk with Ernest Dodson and Casey Davis from the Saving KC team. We know KC tax-sale and title pressure, and we keep redemption conversations private, practical, and fast.',
    teamProof: ['Local KC team', 'Deadline-first review', 'Private cash-offer option'],
    ernestBody: 'Helps you understand the redemption deadline, payoff path, title risk, and whether selling solves the problem.',
    caseyBody: 'Keeps follow-up moving so the file does not sit while the deadline gets closer.',
    testimonials: TAX_TESTIMONIALS,
    reviewsSub: 'Real sellers, real tax pressure, real deadline decisions.',
    finalTitlePrefix: 'Your ',
    finalAccent: 'redemption options',
    finalTitleSuffix: ' start with one address.',
    finalBody: '60 seconds. Four questions. We check the window, the address, and the cleanest path forward.',
    finalCtaLabel: 'Check My Redemption Path',
    faqs: [
      {
        q: 'What is a redemption period?',
        a: 'It is the limited window after some tax sales where the owner may still have a path to redeem the property. The rules depend on the state, county, and sale type.',
      },
      {
        q: 'Can I sell during redemption?',
        a: 'Often there may still be options, but timing and title rules matter. The safest first step is checking the property and deadline quickly.',
      },
      {
        q: 'Do I need the full payoff amount before I call?',
        a: 'No. Tell us what you know. We can start with the address and help you understand what needs to be checked.',
      },
      {
        q: 'What if I want to keep the house?',
        a: 'That is fine. We can still help you understand the possible paths. A cash offer is only one option, not an obligation.',
      },
      {
        q: 'Will this be private?',
        a: 'Yes. No public listing, no open houses, and no pressure. You speak directly with our local team.',
      },
    ],
  },
  'excess-proceeds': {
    rootClass: 'excess-proceeds-variant',
    navJumpLabel: 'Check Proceeds',
    heroEyebrow: 'Excess-proceeds help · KC metro',
    heroTitle: 'County may be holding money',
    heroAccent: 'after a tax sale.',
    heroSummary: 'If a property sold at tax sale for more than the taxes owed, the surplus may belong to the former owner or rightful heirs. We help you check the address, understand the claim path, and decide whether you want help moving it forward.',
    heroBullets: [
      { strong: 'Check whether proceeds may exist.', muted: 'Start with the property address.' },
      { strong: 'Heir and owner questions welcome.', muted: 'We keep it clear and private.' },
      { strong: 'No upfront fee to ask.' },
      { strong: 'Cash-now option if you want speed.' },
    ],
    toolIcon: 'savings',
    toolEyebrow: 'Check for surplus funds',
    toolTitle: 'See If Excess Proceeds May Be Available.',
    toolSub: 'Four quick questions. We start with the sale status and the address.',
    step1Question: 'Do you think there are excess proceeds?',
    situationTiles: [
      { value: 'excess-proceeds', icon: 'savings', label: 'Yes / I received notice' },
      { value: 'excess-not-sure', icon: 'help', label: 'Not sure / check for me' },
    ],
    auctionQuestion: 'Has the property already sold at tax sale?',
    timelineQuestion: 'When did the sale happen?',
    timelineTiles: [
      { value: 'asap', label: 'Under 30 days' },
      { value: '60-days', label: 'Last 12 months' },
      { value: 'flexible', label: 'More than 12 months' },
      { value: 'exploring', label: 'I do not know' },
    ],
    conditionQuestion: 'What makes the claim hard?',
    conditionTiles: [
      { value: 'proceeds-claim', icon: 'assignment', label: 'Need claim filed' },
      { value: 'proceeds-heirs', icon: 'groups', label: 'Multiple heirs/owners' },
      { value: 'proceeds-liens', icon: 'account_balance', label: 'Lien or title questions' },
      { value: 'proceeds-cash-now', icon: 'payments', label: 'Want cash now' },
    ],
    nextOfferLabel: 'Check My Proceeds Path',
    readyText: 'Proceeds review ready — finish below so we can check the address.',
    midCtaTitle: 'Surplus funds can disappear when',
    midCtaAccent: 'deadlines get missed.',
    midCtaBody: 'Counties do not always make the process easy. The right paperwork, owner proof, and timing can decide whether money gets claimed or left behind.',
    midCtaLabel: 'Check Proceeds',
    midStats: [
      { number: '$0', label: 'Upfront to check' },
      { number: '1 hour', label: 'Initial file review' },
    ],
    timelineEyebrow: 'Claim path in 3 moves',
    timelineTitle: 'Find the file.',
    timelineAccent: 'Protect the claim.',
    timelineSub: 'Start with the address. Then we check whether the sale may have created surplus funds and what proof is likely needed.',
    timelineSteps: [
      ['1', 'Today', 'Tell us the address', 'Give us the property and what notice, letter, or sale detail you have.'],
      ['2', 'Today', 'We check the sale path', 'We look for surplus indicators, owner/heir issues, liens, and claim deadlines.'],
      ['3', 'Next step', 'Claim it or get a cash option', 'You decide whether to pursue the claim yourself or talk through a faster option.'],
    ],
    decisionEyebrow: 'What are you trying to solve?',
    decisionTitle: 'Choose the claim issue.',
    decisionAccent: 'We show the next step.',
    decisionSub: 'Most excess-proceeds files need clarity on money, proof, heirs, or liens.',
    decisionTop: 'The property may be gone, but the money may not be.',
    decisionRows: [
      {
        tone: 'brand',
        icon: 'savings',
        stage: 'Money',
        title: 'I think the county owes me money',
        body: 'You got a letter, heard about surplus funds, or saw the sale price.',
        ifLabel: 'First move',
        ifValue: 'Check whether the sale looks like it created excess proceeds.',
        thenLabel: 'You get',
        thenValue: 'A clearer read on whether a claim is worth chasing',
        cta: 'Check',
      },
      {
        tone: 'amber',
        icon: 'groups',
        stage: 'Heirs',
        title: 'There are multiple owners or heirs',
        body: 'The right person may need to sign or prove their claim.',
        ifLabel: 'First move',
        ifValue: 'Map the owner/heir issue before paperwork goes sideways.',
        thenLabel: 'You get',
        thenValue: 'A cleaner claim path',
        cta: 'Start',
      },
      {
        tone: 'green',
        icon: 'payments',
        stage: 'Cash now',
        title: 'I want a faster option',
        body: 'Some people do not want to wait on a slow claim process.',
        ifLabel: 'First move',
        ifValue: 'Talk through whether a cash-now option makes sense.',
        thenLabel: 'You get',
        thenValue: 'Speed, certainty, and a private conversation',
        cta: 'Show me',
      },
    ],
    guaranteeTitle: 'The',
    guaranteeAccent: 'clear-claim promise.',
    guaranteeBody: 'We will tell you what we can see, what is still unknown, and what proof may be needed. No pressure, no public listing, and no fake guarantees.',
    guaranteeChecks: ['No upfront fee', 'Private review', 'Plain-English next steps'],
    teamBody: 'You will talk with Ernest Dodson and Casey Davis from the Saving KC team. We help owners and heirs understand tax-sale surplus questions without turning the process into a maze.',
    teamProof: ['Local KC team', 'Owner/heir path review', 'Private proceeds check'],
    ernestBody: 'Helps you understand the claim path, owner proof, lien issues, and whether a cash-now option makes sense.',
    caseyBody: 'Keeps follow-up simple and gathers the details needed to keep the claim review moving.',
    testimonials: TAX_TESTIMONIALS,
    reviewsSub: 'Real sellers, real tax-sale pressure, real surplus conversations.',
    finalTitlePrefix: 'Your ',
    finalAccent: 'excess proceeds check',
    finalTitleSuffix: ' starts with the address.',
    finalBody: '60 seconds. Four questions. We check the sale status, address, and likely claim path.',
    finalCtaLabel: 'Check My Proceeds',
    faqs: [
      {
        q: 'What are excess proceeds?',
        a: 'They are potential surplus funds left after a tax sale if the sale price was higher than the taxes, costs, and allowed payoffs.',
      },
      {
        q: 'Who can claim the money?',
        a: 'Usually the former owner or rightful claimant, but heirs, liens, and title issues can change the path. That is why the address and ownership story matter.',
      },
      {
        q: 'Do I need paperwork before I call?',
        a: 'No. A notice, letter, sale date, or even just the property address is enough to start the review.',
      },
      {
        q: 'Can you guarantee funds are available?',
        a: 'No. Nobody should guarantee that without checking the file. We can help you understand what looks possible and what still needs proof.',
      },
      {
        q: 'Is this private?',
        a: 'Yes. The conversation stays with our local team. We do not sell your information to a list.',
      },
    ],
  },
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How much will I actually get?',
    a: 'We look at what the house is worth, what repairs cost, and any taxes or liens. Then we show you the number in plain English. No hidden math.',
  },
  {
    q: 'Do I need to pay the back taxes before selling?',
    a: 'No. If we buy the house, the back taxes can be paid at closing from the sale money. You do not need to write a check first.',
  },
  {
    q: 'Can you buy if the house is still in probate?',
    a: 'Often, yes. We can work with the probate path and help you understand what needs to happen before closing.',
  },
  {
    q: 'What if there are tenants in the property?',
    a: 'We can buy with tenants in place. You do not have to evict first or have a hard talk before you call us.',
  },
  {
    q: 'Are there any fees or commissions?',
    a: 'No. No agent commission, no repair bill from us, and no cleanup bill from us. We show any taxes or payoffs before you sign.',
  },
  {
    q: 'How fast can you close?',
    a: 'Often 7 to 30 days if title is clear. If you need more time, we can usually give you 60 days.',
  },
  {
    q: 'Why should I trust Saving KC over the other "cash for houses" guys?',
    a: 'We are local KC buyers. We do not sell your lead to a list. You talk with our team, get a clear offer, and choose if it works for you.',
  },
]
