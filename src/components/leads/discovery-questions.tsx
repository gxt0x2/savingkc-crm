// Discovery Questions — the 1-3 questions that actually gate the deal
// right now. Each slot maps to a pillar of "is this a deal?" and
// "is it with us?" We analyze the manifest + activities + notes to find
// which pillars have NO signal yet, then surface those as pointed asks.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useCardCollapse } from '@/hooks/use-card-collapse'

type Pillar =
  | 'MOTIVATION'
  | 'URGENCY'
  | 'PRICE'
  | 'CONDITION'
  | 'DECISION_MAKERS'
  | 'COMPETITION'
  | 'WHY_US'

interface Gap {
  pillar: Pillar
  question: string
  why: string
  priority: number
}

const PILLAR_LABELS: Record<Pillar, string> = {
  MOTIVATION: 'Motivation',
  URGENCY: 'Urgency',
  PRICE: 'Price Floor',
  CONDITION: 'Condition',
  DECISION_MAKERS: 'Decision Makers',
  COMPETITION: 'Competition',
  WHY_US: 'Why Us',
}

const PILLAR_ICON: Record<Pillar, string> = {
  MOTIVATION: 'psychology',
  URGENCY: 'schedule',
  PRICE: 'payments',
  CONDITION: 'home_work',
  DECISION_MAKERS: 'groups',
  COMPETITION: 'swords',
  WHY_US: 'favorite',
}

interface DiscoveryQuestionsProps {
  leadId: string
  notes?: string | null
  sellerSituation?: string | null
  offerAmount?: number | null
  sqft?: number | null
  yearBuilt?: number | null
  activities?: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
  }>
}

function hasText(...vals: (string | null | undefined)[]): boolean {
  return vals.some((v) => typeof v === 'string' && v.trim().length > 0)
}

function analyzeGaps(
  manifest: any,
  props: DiscoveryQuestionsProps
): Gap[] {
  const gaps: Gap[] = []

  const allText = [
    props.notes || '',
    props.sellerSituation || '',
    ...(props.activities || []).map((a) => a.description || ''),
  ]
    .join(' ')
    .toLowerCase()

  const transcripts: any[] = manifest?.communications?.transcripts || []
  const transcriptText = transcripts
    .map((t) => [t.aiSummary, t.agentNotes, ...(t.extractedData?.verbatimQuotes || [])].join(' '))
    .join(' ')
    .toLowerCase()

  // ── MOTIVATION: do we know WHY they're considering selling?
  const motivationPrimary = manifest?.situation?.motivation?.primary
  const motivationSignals: string[] = manifest?.situation?.motivation?.signals || []
  const hasMotivation =
    hasText(motivationPrimary, props.sellerSituation) ||
    motivationSignals.length > 0 ||
    /divorce|inherited|foreclosure|probate|moving|relocat|tired|downsize|medical|job loss/i.test(
      allText
    )
  if (!hasMotivation) {
    gaps.push({
      pillar: 'MOTIVATION',
      question: "What's got you even considering selling?",
      why: 'We have no motivation on record. Without a real reason, this is a tire-kicker.',
      priority: 100,
    })
  }

  // ── URGENCY: is there a deadline or forcing function?
  const deadline = manifest?.situation?.timeline?.sellerDeadline
  const preferredClose = manifest?.situation?.timeline?.preferredClosing
  const urgency = manifest?.situation?.motivation?.urgencyLevel
  const urgencyText = /foreclosure|auction|tax sale|eviction|deadline|asap|this month|by the end of/i
  const hasUrgency =
    hasText(deadline, preferredClose, urgency) || urgencyText.test(allText) || urgencyText.test(transcriptText)
  if (!hasUrgency) {
    gaps.push({
      pillar: 'URGENCY',
      question: "What happens if this doesn't get resolved?",
      why: 'No deadline or forcing function yet. Surface the pain clock.',
      priority: 95,
    })
  }

  // ── PRICE: do we have a floor or walk-away number?
  const sellerFloor = manifest?.situation?.priceExpectations?.sellerFloor
  const sellerAsking = manifest?.situation?.priceExpectations?.sellerAsking
  const minAcceptable = manifest?.situation?.priceExpectations?.minimumAcceptable
  const hasPrice =
    sellerFloor != null ||
    sellerAsking != null ||
    minAcceptable != null ||
    (props.offerAmount != null && props.offerAmount > 0) ||
    /walk away with|need.*to walk|asking price|i need|gotta get|looking for/i.test(allText)
  if (!hasPrice) {
    gaps.push({
      pillar: 'PRICE',
      question: 'How much do you need to walk away with?',
      why: 'No price anchor. Every offer conversation is blind without this.',
      priority: 90,
    })
  }

  // ── CONDITION: do we know the actual state of the property?
  const conditionScore = manifest?.property?.conditionScore
  const conditionNotes = manifest?.property?.conditionNotes
  const vacant = manifest?.property?.vacant
  const occupied = manifest?.property?.occupied
  const hasCondition =
    conditionScore != null ||
    hasText(conditionNotes) ||
    vacant === true ||
    vacant === false ||
    occupied != null ||
    /repairs|rehab|roof|foundation|leak|mold|gutted|remodel|rented|tenant|vacant|lived in/i.test(
      allText
    )
  if (!hasCondition && (!props.sqft || !props.yearBuilt)) {
    gaps.push({
      pillar: 'CONDITION',
      question: 'What shape is the property in today?',
      why: "We can't price without condition. Vacant vs. occupied changes everything.",
      priority: 75,
    })
  }

  // ── DECISION MAKERS: is anyone else on the deed or involved?
  const decisionMakers: string[] = manifest?.owner?.decisionMakers || []
  const influencers: string[] = manifest?.owner?.influencers || []
  const coOwners: string[] = manifest?.owner?.coOwners || []
  const mentionsOthers = /my (wife|husband|spouse|partner|son|daughter|brother|sister|mom|dad|mother|father)|we own|both of us|our house|co-owner|co owner/i.test(
    allText + ' ' + transcriptText
  )
  const hasDecisionMakers =
    decisionMakers.length > 0 || influencers.length > 0 || coOwners.length > 0 || mentionsOthers
  if (!hasDecisionMakers) {
    gaps.push({
      pillar: 'DECISION_MAKERS',
      question: 'Who else needs to sign off before this happens?',
      why: 'If we sell someone who can\'t decide alone, we lose at the table.',
      priority: 70,
    })
  }

  // ── COMPETITION: have they talked to other buyers/agents?
  const mentionedCompetition = /other (buyer|offer|investor)|another offer|listed with|talking to.*(agent|realtor|investor)|we buy houses|competitor/i.test(
    allText + ' ' + transcriptText
  )
  const knownCompetition: string[] =
    manifest?.situation?.competition?.otherParties ||
    manifest?.ariIntelligence?.competition?.competitors ||
    []
  const hasCompetition = mentionedCompetition || knownCompetition.length > 0
  if (!hasCompetition) {
    gaps.push({
      pillar: 'COMPETITION',
      question: 'Who else have you been talking to about the property?',
      why: 'If we don\'t know the competition, we can\'t position against them.',
      priority: 60,
    })
  }

  // ── WHY US: proof-of-life — did they say why they're talking to us?
  const proofOfLifePhrases = /your (letter|card|mailer|postcard|site)|saw your|got your|want to work with|trust|heard good|recommend|your ad|your sign/i
  const hasWhyUs = proofOfLifePhrases.test(allText + ' ' + transcriptText)
  if (!hasWhyUs) {
    gaps.push({
      pillar: 'WHY_US',
      question: "Why are we the ones you're talking to right now?",
      why: 'Proof of life. If they can\'t answer, we\'re being shopped.',
      priority: 55,
    })
  }

  return gaps.sort((a, b) => b.priority - a.priority)
}

export function DiscoveryQuestions(props: DiscoveryQuestionsProps) {
  const { leadId } = props
  const storageKey = `crm_discovery_asked_${leadId}`
  const [asked, setAsked] = useState<Set<Pillar>>(new Set())
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [open, toggleOpen] = useCardCollapse('discovery-questions', false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setAsked(new Set(JSON.parse(raw) as Pillar[]))
    } catch {
      /* ignore */
    }
  }, [storageKey])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('manifests')
          .select('manifest')
          .eq('lead_id', leadId)
          .limit(1)
          .maybeSingle()
        if (!cancelled) setManifest(data?.manifest ?? null)
      } catch {
        if (!cancelled) setManifest(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (leadId) load()
    return () => { cancelled = true }
  }, [leadId, props.notes, props.sellerSituation, props.activities?.length])

  const allGaps = useMemo(() => analyzeGaps(manifest, props), [manifest, props])
  const visible = useMemo(
    () => allGaps.filter((g) => !asked.has(g.pillar)).slice(0, 3),
    [allGaps, asked]
  )

  function markAsked(pillar: Pillar) {
    setAsked((prev) => {
      const next = new Set(prev)
      next.add(pillar)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  function reset() {
    setAsked(new Set())
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between mb-4"
      >
        <div className="flex items-center gap-2">
          <Icon name="quiz" className="!text-base !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Questions That Still Matter</h2>
        </div>
        <div className="flex items-center gap-2">
          {asked.size > 0 && (
            <span
              onClick={(e) => { e.stopPropagation(); reset() }}
              role="button"
              className="text-[10px] font-bold hover:underline cursor-pointer"
              style={{ color: 'var(--ck-text-muted)' }}
            >
              Reset
            </span>
          )}
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </button>

      {!open ? null : loading ? (
        <div className="flex items-center gap-2 py-2">
          <div
            className="w-3 h-3 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(239,68,68,0.3)', borderTopColor: 'var(--ck-accent)' }}
          />
          <span className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>
            Analyzing what we know…
          </span>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-3">
          <Icon name="task_alt" className="!text-2xl !text-[color:var(--ck-success)] mb-1" />
          <p className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>
            {allGaps.length === 0
              ? 'All core pillars covered. Time to close.'
              : 'You\'ve logged every gap on the board.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((gap) => (
            <li
              key={gap.pillar}
              className="rounded-xl p-3 border group"
              style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  name={PILLAR_ICON[gap.pillar]}
                  className="!text-sm mt-0.5 shrink-0 !text-[color:var(--ck-accent)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="ck-microlabel mb-1" style={{ color: 'var(--ck-accent)' }}>
                    {PILLAR_LABELS[gap.pillar]}
                  </p>
                  <p
                    className="text-sm font-semibold leading-snug"
                    style={{ color: 'var(--ck-text)' }}
                  >
                    {gap.question}
                  </p>
                </div>
                <button
                  onClick={() => markAsked(gap.pillar)}
                  title="Mark as asked"
                  className="shrink-0 w-6 h-6 rounded-md border flex items-center justify-center transition-colors hover:border-[color:var(--ck-accent)] hover:text-[color:var(--ck-accent)]"
                  style={{ borderColor: 'var(--ck-border-strong)', color: 'var(--ck-text-muted)' }}
                >
                  <Icon name="check" className="!text-xs" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
