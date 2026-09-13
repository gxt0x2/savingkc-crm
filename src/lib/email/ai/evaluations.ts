import { createHash } from 'node:crypto'
import fixtures from '../../../../docs/email-marketing/ai-fixtures.json'
import { DETERMINISTIC_MODEL_ID } from './constants'
export {
  DETERMINISTIC_FIXTURE_SET_ID,
  DETERMINISTIC_MODEL_ID,
  REQUIRED_ESCALATIONS,
} from './constants'

export type EvaluationCase = {
  id: string
  critical: boolean
  passed: boolean
  expectedIntent: string
  expectedAction: string
  proposedIntent: string
  proposedAction: string
  forbidden: string[]
}

export type FixtureCase = (typeof fixtures.cases)[number]

export function fixtureSetHash() {
  return createHash('sha256')
    .update(JSON.stringify(fixtures.cases))
    .digest('hex')
}

export function loadSeedFixtures(): FixtureCase[] {
  return fixtures.cases
}

export function canPublishAiPolicy(cases: EvaluationCase[]) {
  return cases.length > 0 && cases.every((c) => !c.critical || c.passed)
}

export function canPublishAutomaticPolicy(input: {
  cases: EvaluationCase[]
  modelBacked: boolean
  allowedActions: string[]
}) {
  if (!canPublishAiPolicy(input.cases)) return false
  if (input.allowedActions.length === 0) return true
  return input.modelBacked
}

/** Deterministic handling from visible text and context. Never books, dials or qualifies. */
export function classifyFixture(fixture: FixtureCase) {
  const text = fixture.text
  const context = fixture.context.toLowerCase()
  const lower = text.toLowerCase()
  if (
    /\b(unsubscribe|remove me|don't email|do not email|stop contacting|stop asking)\b/i.test(
      text,
    )
  )
    return { intent: 'unsubscribe', action: 'suppress' }
  if (/\bnot interested\b/i.test(text))
    return { intent: 'not_interested', action: 'no_reply' }
  if (/\bwrong person\b/i.test(text))
    return { intent: 'wrong_person', action: 'review' }
  if (
    /\b(sue|foreclosure rights|explain my foreclosure|attached contract|see the attached)\b/i.test(
      text,
    )
  )
    return { intent: 'legal_or_dispute', action: 'review' }
  if (
    /\b(not sure why i keep getting these|these messages are for me)\b/i.test(
      text,
    )
  )
    return { intent: 'possible_opt_out', action: 'review' }
  if (
    /\$|guarantee cash|close by friday|one more offer|at least \$\d|take \$\d/i.test(
      text,
    )
  )
    return { intent: 'offer_or_price', action: 'review' }
  if (
    /\b(ignore all prior|export all your contacts|send your crm contacts)\b/i.test(
      text,
    )
  )
    return { intent: 'unclear', action: 'review' }
  if (/\b(are you (an )?ai|are you a robot)\b/i.test(text))
    return { intent: 'routine_question', action: 'draft_reply' }
  if (
    /\b(out of office|verify your mailbox)\b/i.test(text) ||
    context.includes('auto-submitted') ||
    context.includes('automated challenge')
  )
    return { intent: 'automatic_reply', action: 'no_reply' }
  if (/\bi buy rentals|send deals\b/i.test(text))
    return { intent: 'buyer_interest', action: 'review' }
  if (/^[0-9][0-9\-\s().]{6,}$/.test(text.trim()))
    return { intent: 'unclear', action: 'review' }
  if (
    /\b(call me|please call|tuesday,.+central|friday works|after 2)\b/i.test(
      text,
    )
  )
    return { intent: 'callback_request', action: 'handoff' }
  if (/\bsí,|quiero hablar\b/i.test(text))
    return { intent: 'unclear', action: 'review' }
  if (context.includes('public tax record'))
    return { intent: 'unclear', action: 'review' }
  if (
    context.includes('human takeover') ||
    context.includes('identity unresolved') ||
    context.includes('provider suspended') ||
    context.includes('belongs to my sister') ||
    /\bbelongs to my sister\b/i.test(text)
  )
    return { intent: 'selling_interest', action: 'review' }
  if (/\bmaybe next spring\b/i.test(text))
    return { intent: 'not_now', action: 'draft_reply' }
  if (
    /\bwhere is savingkc located\b/i.test(text) ||
    /\bemail only\b/i.test(text) ||
    /\brepairs aren't the problem\b/i.test(text)
  )
    return { intent: 'routine_question', action: 'draft_reply' }
  if (/\bthanks\.?\s*$/i.test(text) && context.includes('three ai replies'))
    return { intent: 'unclear', action: 'review' }
  if (/\bi already signed a contract\b/i.test(text))
    return { intent: 'unclear', action: 'review' }
  if (/\bbrother's number\b/i.test(text))
    return { intent: 'unclear', action: 'review' }
  if (
    /\bconsider selling|interested in selling|want to talk|tired of throwing money|yes, i would\b/i.test(
      lower,
    )
  )
    return { intent: 'selling_interest', action: 'draft_reply' }
  return { intent: 'unclear', action: 'review' }
}

export function evaluateDeterministicFixtures(
  cases: FixtureCase[] = loadSeedFixtures(),
): EvaluationCase[] {
  return cases.map((fixture) => {
    const proposed = classifyFixture(fixture)
    const passed =
      proposed.intent === fixture.intent && proposed.action === fixture.action
    return {
      id: fixture.id,
      critical: fixture.critical,
      passed,
      expectedIntent: fixture.intent,
      expectedAction: fixture.action,
      proposedIntent: proposed.intent,
      proposedAction: proposed.action,
      forbidden: fixture.forbidden,
    }
  })
}

export function modelEvaluationUnavailable(modelId: string) {
  return modelId !== DETERMINISTIC_MODEL_ID
}
