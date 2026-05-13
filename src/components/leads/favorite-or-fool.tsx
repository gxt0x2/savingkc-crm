// Favorite or Fool — Chris Voss Negotiation Diagnostic
// Diagnoses whether we are the seller's FAVORITE (they want to work with us)
// or the FOOL (they're shopping us for leverage / price comparison).
// Based on manifest call analyzer output + communication signals.

'use client'

import { useState, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useCardCollapse } from '@/hooks/use-card-collapse'

interface FavoriteOrFoolProps {
  leadId: string
  manifestId?: string
  motivationScore: number | null
  arv: number | null
  offerAmount: number | null
  repairEstimate: number | null
  station: string | null
  notes: string | null
  sellerSituation: string | null
  // Lead-state signals added 2026-04-19 to eliminate UNDETERMINED for
  // leads without transcript extractedData. All optional — component
  // reads them if passed, falls back to just manifest signals otherwise.
  classification?: string | null
  priority?: string | null
  isFavorite?: boolean | null
  opportunityScore?: number | null
  activities?: Array<{
    activity_type: string
    created_at: string
  }>
}

interface ManifestData {
  source?: string
  owner?: {
    fullName?: string
    personalityType?: string
    contactPreference?: string
  }
  situation?: {
    motivation?: {
      primary?: string
      signals?: string[]
      score?: number
    }
    timeline?: {
      urgency?: string
      preferredClosing?: string
      flexibility?: string
    }
    priceExpectations?: {
      sellerAsking?: number
      sellerFloor?: number
      priceFlexibility?: string
      askingPrice?: number
      minimumAcceptable?: number
    }
    objections?: string[]
    blockers?: string[]
  }
  communications?: {
    transcripts?: Array<{
      date?: string
      aiSummary?: string
      agentNotes?: string
      extractedData?: {
        motivationScore?: number
        sentiment?: string
        rapportLevel?: string
        verbatimQuotes?: string[]
        objectionsRaised?: string[]
        concessionSignals?: string[]
        keyLeverage?: string[]
        personalityType?: string
      }
    }>
  }
  ariIntelligence?: {
    sellerProfile?: {
      personalityType?: string
      communicationStyle?: string
      emotionalDrivers?: string[]
    }
    dealIntelligence?: {
      confidenceScore?: number
    }
  }
  agentNotes?: Array<{
    content?: string
    source?: string
  }>
}

type Diagnosis = 'favorite' | 'likely_favorite' | 'unknown' | 'likely_fool' | 'fool'

interface DiagnosisResult {
  diagnosis: Diagnosis
  confidence: number // 0–100
  proofOfLife: string[]    // Signals they WANT to work with us
  foolSignals: string[]    // Signals they're shopping us
  recommendation: string
}

/**
 * Analyze manifest for Chris Voss "Favorite or Fool" signals.
 *
 * FAVORITE signals (Proof of Life):
 * - They called us / responded to our marketing
 * - They explained WHY they want to work with us
 * - They referenced our mailer / marketing piece
 * - They described a future that includes us
 * - They shared personal information freely
 * - They set or kept an appointment
 * - They responded quickly to follow-ups
 * - High rapport level from call analyzer
 * - Concession signals detected
 *
 * FOOL signals:
 * - They just asked for a number / price
 * - Won't commit to timeline or appointment
 * - Shopping multiple buyers
 * - Asking "what's your best offer?"
 * - Low rapport, transactional tone
 * - Ghosting after getting our number
 * - Price-only objections with no personal info shared
 */
function diagnose(manifest: ManifestData, props: FavoriteOrFoolProps): DiagnosisResult {
  const proofOfLife: string[] = []
  const foolSignals: string[] = []

  // ── Lead source analysis ──
  const source = (manifest.source || '').toLowerCase()
  if (source.includes('inbound') || source === 'inbound_call' || source === 'inbound_text' || source === 'web_form') {
    proofOfLife.push('They reached out to us first')
  }

  // ── Call transcript signals ──
  const transcripts = manifest.communications?.transcripts || []
  for (const t of transcripts) {
    const ex = t.extractedData
    if (!ex) continue

    // Rapport level
    const rapport = (ex.rapportLevel || '').toLowerCase()
    if (rapport.includes('high') || rapport.includes('strong') || rapport.includes('excellent')) {
      proofOfLife.push('Strong rapport built during call')
    } else if (rapport.includes('low') || rapport.includes('poor') || rapport.includes('hostile')) {
      foolSignals.push('Low rapport — transactional tone')
    }

    // Sentiment
    if (ex.sentiment === 'positive') {
      proofOfLife.push('Positive sentiment in conversation')
    } else if (ex.sentiment === 'negative') {
      foolSignals.push('Negative sentiment — resistant or guarded')
    }

    // Concession signals = they're moving toward us
    if (ex.concessionSignals?.length) {
      proofOfLife.push(`Concession signals: ${ex.concessionSignals.slice(0, 2).join('; ')}`)
    }

    // Verbatim quotes — look for proof of life language
    if (ex.verbatimQuotes?.length) {
      for (const q of ex.verbatimQuotes) {
        const ql = q.toLowerCase()
        // Proof of life: references to our marketing, wanting to work with us, describing future with us
        if (ql.includes('got your') || ql.includes('your letter') || ql.includes('your card') ||
            ql.includes('your mailer') || ql.includes('postcard') || ql.includes('saw your')) {
          proofOfLife.push(`Referenced our marketing: "${q.slice(0, 80)}"`)
        }
        if (ql.includes('want to work with') || ql.includes('heard good things') ||
            ql.includes('trust') || ql.includes('recommend')) {
          proofOfLife.push(`Expressed trust: "${q.slice(0, 80)}"`)
        }
        // Fool: just wants a number, shopping
        if (ql.includes('best offer') || ql.includes('what can you give') ||
            ql.includes('how much') || ql.includes('just give me a number')) {
          foolSignals.push(`Price shopping: "${q.slice(0, 80)}"`)
        }
        if (ql.includes('other buyer') || ql.includes('someone else') ||
            ql.includes('another offer') || ql.includes('shopping around')) {
          foolSignals.push(`Shopping multiple buyers: "${q.slice(0, 80)}"`)
        }
      }
    }

    // Objections — lots of price-only objections = fool signal
    if (ex.objectionsRaised?.length) {
      const priceObj = ex.objectionsRaised.filter(o => {
        const ol = o.toLowerCase()
        return ol.includes('price') || ol.includes('too low') || ol.includes('more money') || ol.includes('not enough')
      })
      if (priceObj.length >= 2) {
        foolSignals.push('Multiple price-only objections — no emotional engagement')
      }
    }

    // Key leverage = they gave us something to work with
    if (ex.keyLeverage?.length) {
      proofOfLife.push(`Shared leverage: ${ex.keyLeverage.slice(0, 2).join('; ')}`)
    }
  }

  // ── Motivation signals ──
  const motivationSignals = manifest.situation?.motivation?.signals || []
  for (const sig of motivationSignals) {
    const sl = sig.toLowerCase()
    if (sl.includes('called us') || sl.includes('reached out') || sl.includes('inbound')) {
      if (!proofOfLife.some(p => p.includes('reached out'))) {
        proofOfLife.push('Seller initiated contact')
      }
    }
  }

  // ── Timeline commitment ──
  const timeline = manifest.situation?.timeline
  if (timeline) {
    const urgency = (timeline.urgency || '').toLowerCase()
    const flexibility = (timeline.flexibility || '').toLowerCase()
    if (urgency.includes('immediate') || urgency.includes('urgent') || urgency.includes('asap')) {
      proofOfLife.push('Committed to urgent timeline')
    }
    if (flexibility.includes('flexible') || flexibility.includes('open')) {
      proofOfLife.push('Flexible on terms — willing to work with us')
    }
    if (urgency.includes('not sure') || urgency.includes('no rush') || urgency.includes('just looking')) {
      foolSignals.push('No timeline commitment — "just looking"')
    }
  }

  // ── Price flexibility ──
  const priceExpectations = manifest.situation?.priceExpectations
  if (priceExpectations) {
    const flex = (priceExpectations.priceFlexibility || '').toLowerCase()
    if (flex.includes('flexible') || flex.includes('negotiable') || flex.includes('open')) {
      proofOfLife.push('Price flexible — willing to negotiate')
    }
    if (flex.includes('firm') || flex.includes('non-negotiable') || flex.includes('won\'t budge')) {
      foolSignals.push('Price firm — no flexibility')
    }
  }

  // ── Station progression = engagement proof ──
  const stationSignals: Record<string, { type: 'proof' | 'fool'; text: string }> = {
    appt_set: { type: 'proof', text: 'Agreed to appointment — committed time to us' },
    negotiations: { type: 'proof', text: 'In active negotiations — invested in deal' },
    contract_signed: { type: 'proof', text: 'Contract signed — we are clearly the favorite' },
    dead: { type: 'fool', text: 'Deal went dead — likely chose someone else' },
  }
  const stationSig = stationSignals[props.station || '']
  if (stationSig) {
    if (stationSig.type === 'proof') proofOfLife.push(stationSig.text)
    else foolSignals.push(stationSig.text)
  }

  // ── Agent notes scan for key phrases ──
  const allNotes = [
    ...(manifest.agentNotes || []).map(n => n.content || ''),
    props.notes || '',
    props.sellerSituation || '',
  ].join(' ').toLowerCase()

  if (allNotes.includes('called back') || allNotes.includes('returned call') || allNotes.includes('replied')) {
    proofOfLife.push('Seller returned our contact — engaged')
  }
  if (allNotes.includes('ghosting') || allNotes.includes('no response') || allNotes.includes('won\'t answer')) {
    foolSignals.push('Ghosting — not responding to follow-ups')
  }
  if (allNotes.includes('got another offer') || allNotes.includes('talking to other') || allNotes.includes('realtor')) {
    foolSignals.push('Talking to other buyers/realtors')
  }

  // ── Personality type from Black Swan framework ──
  const personality = manifest.ariIntelligence?.sellerProfile?.personalityType ||
    manifest.owner?.personalityType || ''
  if (personality.toLowerCase().includes('accommodator')) {
    proofOfLife.push('Accommodator personality — relationship-driven, likely loyal')
  }
  if (personality.toLowerCase().includes('assertive')) {
    foolSignals.push('Assertive personality — may push for best price from multiple buyers')
  }

  // ── Lead-state signals ──
  // These pull from the leads row (classification, priority, favorite,
  // opportunity score, motivation) so the diagnosis never renders
  // UNDETERMINED just because the call wasn't AI-transcribed yet.
  if (props.isFavorite) {
    proofOfLife.push('Starred by agent — flagged as priority lead')
  }
  if (props.classification === 'opportunity') {
    proofOfLife.push('Scored as opportunity by pipeline')
  } else if (props.classification === 'lead') {
    proofOfLife.push('Qualified lead in pipeline')
  }
  if (props.classification === 'dead') {
    foolSignals.push('Pipeline classified as dead')
  }
  if ((props.opportunityScore ?? 0) >= 75) {
    proofOfLife.push(`High opportunity score (${props.opportunityScore}/100)`)
  } else if ((props.opportunityScore ?? 0) >= 40) {
    proofOfLife.push(`Moderate opportunity score (${props.opportunityScore}/100)`)
  } else if ((props.opportunityScore ?? 0) > 0 && (props.opportunityScore ?? 0) < 20) {
    foolSignals.push(`Low opportunity score (${props.opportunityScore}/100)`)
  }
  if ((props.motivationScore ?? 0) >= 8) {
    proofOfLife.push(`High motivation (${props.motivationScore}/10)`)
  } else if ((props.motivationScore ?? 0) >= 5) {
    proofOfLife.push(`Moderate motivation (${props.motivationScore}/10)`)
  }
  const priority = (props.priority || '').toLowerCase()
  if (priority === 'hot') {
    proofOfLife.push('Priority: hot')
  } else if (priority === 'warm') {
    proofOfLife.push('Priority: warm')
  } else if (priority === 'cold' && (props.classification === 'dead' || (props.opportunityScore ?? 100) < 20)) {
    foolSignals.push('Priority: cold + low pipeline score')
  }
  const stationLower = (props.station || '').toLowerCase()
  if (['appointment', 'qualifying', 'discovery', 'offer', 'negotiations', 'contract', 'under_contract'].includes(stationLower)) {
    proofOfLife.push(`Active pipeline stage: ${stationLower}`)
  } else if (['intake', 'contacted', 'new'].includes(stationLower)) {
    proofOfLife.push(`In active pipeline: ${stationLower}`)
  }

  // ── Deduplicate ──
  const uniqueProof = [...new Set(proofOfLife)]
  const uniqueFool = [...new Set(foolSignals)]

  // ── Calculate diagnosis ──
  const proofWeight = uniqueProof.length
  const foolWeight = uniqueFool.length
  const total = proofWeight + foolWeight

  let diagnosis: Diagnosis
  let confidence: number
  let recommendation: string

  if (total === 0) {
    diagnosis = 'unknown'
    confidence = 0
    recommendation = 'Not enough data yet. Ask the Proof of Life question: "Why would you want to work with us?" Their answer tells you everything.'
  } else {
    const favoriteRatio = proofWeight / total

    if (favoriteRatio >= 0.8) {
      diagnosis = 'favorite'
      confidence = Math.min(95, 60 + proofWeight * 8)
      recommendation = 'We are the favorite. Hold firm on price — they want to work with US specifically. Don\'t negotiate against yourself.'
    } else if (favoriteRatio >= 0.6) {
      diagnosis = 'likely_favorite'
      confidence = Math.min(80, 40 + proofWeight * 7)
      recommendation = 'Leaning favorite but not locked in. Reinforce the relationship. Ask: "What would it take for you to feel comfortable moving forward with us?"'
    } else if (favoriteRatio >= 0.4) {
      diagnosis = 'unknown'
      confidence = Math.min(50, 20 + total * 5)
      recommendation = 'Could go either way. Time for the Proof of Life question: "It seems like you have a lot of options — why are you talking to us?" Their answer reveals everything.'
    } else if (favoriteRatio >= 0.2) {
      diagnosis = 'likely_fool'
      confidence = Math.min(80, 40 + foolWeight * 7)
      recommendation = 'We\'re likely being shopped. Don\'t give a number yet. Ask: "What would make you choose us over the other options you\'re exploring?" If they can\'t answer, move on.'
    } else {
      diagnosis = 'fool'
      confidence = Math.min(95, 60 + foolWeight * 8)
      recommendation = 'We are the fool on this one. They\'re using our offer as leverage. Stop chasing — your time is better spent on leads where we\'re the favorite.'
    }
  }

  return { diagnosis, confidence, proofOfLife: uniqueProof, foolSignals: uniqueFool, recommendation }
}

const DIAGNOSIS_CONFIG: Record<Diagnosis, { label: string; textClass: string; bg: string; barBg: string; icon: string }> = {
  favorite:       { label: 'THE FAVORITE',     textClass: 'text-green-500',  bg: 'bg-green-500/10',  barBg: 'bg-green-500',  icon: 'verified' },
  likely_favorite: { label: 'LIKELY FAVORITE', textClass: 'text-lime-500',   bg: 'bg-lime-500/10',   barBg: 'bg-lime-500',   icon: 'thumb_up' },
  unknown:        { label: 'UNDETERMINED',      textClass: 'text-yellow-500', bg: 'bg-yellow-500/10', barBg: 'bg-yellow-500', icon: 'help' },
  likely_fool:    { label: 'LIKELY THE FOOL',  textClass: 'text-orange-500', bg: 'bg-orange-500/10', barBg: 'bg-orange-500', icon: 'warning' },
  fool:           { label: 'THE FOOL',          textClass: 'text-red-500',    bg: 'bg-red-500/10',    barBg: 'bg-red-500',    icon: 'block' },
}

function formatLastSeen(activities?: Array<{ activity_type: string; created_at: string }>): string | null {
  if (!activities || activities.length === 0) return null
  const meaningful = ['call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'email', 'appointment', 'note']
  const last = activities.find((a) => meaningful.includes(a.activity_type)) || activities[0]
  if (!last) return null
  const ms = Date.now() - new Date(last.created_at).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function FavoriteOrFool({ leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation, classification, priority, isFavorite, opportunityScore, activities }: FavoriteOrFoolProps) {
  const [manifest, setManifest] = useState<ManifestData>({})
  const [loading, setLoading] = useState(true)
  const [open, toggleOpen] = useCardCollapse('favorite-or-fool')
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    function bump() { setRefreshTick((t) => t + 1) }
    window.addEventListener('crm:lead-refresh', bump)
    return () => window.removeEventListener('crm:lead-refresh', bump)
  }, [])

  useEffect(() => {
    async function fetchManifest() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle()
      if (data?.manifest) setManifest(data.manifest as ManifestData)
      setLoading(false)
    }
    fetchManifest()
  }, [leadId, refreshTick])

  const result = diagnose(manifest, {
    leadId, manifestId, motivationScore, arv, offerAmount, repairEstimate, station, notes, sellerSituation,
    classification, priority, isFavorite, opportunityScore,
  })

  const config = DIAGNOSIS_CONFIG[result.diagnosis]

  if (loading) {
    return (
      <section
        className="rounded-2xl p-5 border"
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(239,68,68,0.3)', borderTopColor: 'var(--ck-accent)' }}
          />
          <span className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>Diagnosing…</span>
        </div>
      </section>
    )
  }

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center gap-2 mb-4"
      >
        <Icon name="psychology" className="!text-base !text-[color:var(--ck-accent)]" />
        <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Favorite or Fool?</h2>
        {(() => {
          const lastSeen = formatLastSeen(activities)
          return lastSeen ? (
            <span
              className="ml-auto text-[10px] font-bold"
              style={{ color: 'var(--ck-text-muted)' }}
              title="Time since last meaningful touch"
            >
              Last: {lastSeen}
            </span>
          ) : null
        })()}
        <Icon
          name={open ? 'expand_less' : 'expand_more'}
          className="!text-base !text-[color:var(--ck-text-muted)] ml-auto"
        />
      </button>

      {!open ? null : (
      <>
      {/* Diagnosis Badge */}
      <div
        className="rounded-xl px-4 py-3 mb-4 border"
        style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Icon name={config.icon} className={`!text-lg ${config.textClass}`} />
          <span className={`text-base font-black tracking-wide ${config.textClass}`}>
            {config.label}
          </span>
        </div>
        {result.confidence > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--ck-border)' }}
            >
              <div
                className={`h-full rounded-full transition-all duration-700 ${config.barBg}`}
                style={{ width: `${result.confidence}%` }}
              />
            </div>
            <span className="text-[10px] font-bold" style={{ color: 'var(--ck-text-muted)' }}>
              {result.confidence}%
            </span>
          </div>
        )}
      </div>

      {/* Proof of Life signals */}
      {result.proofOfLife.length > 0 && (
        <div className="mb-3">
          <p className="ck-microlabel mb-1.5" style={{ color: 'var(--ck-success)' }}>
            Proof of Life
          </p>
          <ul className="space-y-1">
            {result.proofOfLife.map((s, i) => (
              <li
                key={i}
                className="text-xs flex items-start gap-1.5 leading-snug"
                style={{ color: 'var(--ck-text)' }}
              >
                <span className="mt-0.5 shrink-0 font-black" style={{ color: 'var(--ck-success)' }}>+</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fool signals */}
      {result.foolSignals.length > 0 && (
        <div className="mb-3">
          <p className="ck-microlabel mb-1.5" style={{ color: 'var(--ck-accent)' }}>
            Fool Signals
          </p>
          <ul className="space-y-1">
            {result.foolSignals.map((s, i) => (
              <li
                key={i}
                className="text-xs flex items-start gap-1.5 leading-snug"
                style={{ color: 'var(--ck-text)' }}
              >
                <span className="mt-0.5 shrink-0 font-black" style={{ color: 'var(--ck-accent)' }}>−</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      </>
      )}
    </section>
  )
}
