import { TWILIO_NUMBERS, type TwilioNumberConfig } from '@/lib/twilio-numbers'

export type PhoneRouteHealth = 'healthy' | 'attention'
export type PhoneRouteType = 'acquisitions_ivr' | 'google_ads' | 'cold_callback' | 'direct_agent' | 'legacy' | 'dispositions'

export interface PhoneSystemRecord {
  number: string
  label: string
  purpose: TwilioNumberConfig['purpose']
  owner: string
  team: 'Acquisitions' | 'Dispositions'
  routeType: PhoneRouteType
  health: PhoneRouteHealth
  healthNote: string
  workflowId: string
  inboundPath: readonly string[]
  answeredPath: string
  noAnswerPath: string
  smsPath: string
  smsSenderPolicy: string
  outboundUse: string
  carrierFallback: string
  sourceFiles: readonly string[]
}

const COLD_CALLBACK_NUMBERS = new Set([
  '+18163100845',
  '+18162538313',
  '+18164761344',
  '+18164761589',
  '+18166404701',
  '+18165788107',
  '+18166408032',
  '+18166536616',
])

const DIRECT_AGENT_NUMBERS: Record<string, {
  owner: string
  workflowId: string
  team: PhoneSystemRecord['team']
  routeType: PhoneRouteType
  healthNote: string
}> = {
  '+18166088588': { owner: 'Ernest', workflowId: 'ernest-direct-call-flow', team: 'Acquisitions', routeType: 'direct_agent', healthNote: 'Direct company line for Ernest.' },
  '+18166088858': { owner: 'Ernest', workflowId: 'dispositions-inbound-call-flow', team: 'Dispositions', routeType: 'dispositions', healthNote: 'Direct dispositions line owned by Ernest.' },
  '+18167277667': { owner: 'Casey', workflowId: 'casey-direct-call-flow', team: 'Acquisitions', routeType: 'direct_agent', healthNote: 'Direct company line for Casey.' },
  '+18163754666': { owner: 'Casey', workflowId: 'casey-legacy-call-flow', team: 'Acquisitions', routeType: 'legacy', healthNote: 'Legacy Casey line now follows Casey direct routing.' },
}

const GOOGLE_ADS_NUMBERS: Record<string, { label: string; workflowId: string }> = {
  '+18166088808': { label: 'Google Ads Search 2026', workflowId: 'google-ads-general-call-flow' },
  '+18166086648': { label: 'Google Ads Property Tax', workflowId: 'google-ads-tax-call-flow' },
}

function routeFor(config: TwilioNumberConfig): PhoneSystemRecord {
  const sourceFiles = ['/api/twiml-voice', '/api/twilio-sms-webhook', '/api/twilio/fallback/voice', '/api/twilio/fallback/sms', 'src/lib/twilio-numbers.ts'] as const
  const direct = DIRECT_AGENT_NUMBERS[config.value]
  if (direct) {
    return {
      number: config.value,
      label: config.label,
      purpose: config.purpose,
      owner: direct.owner,
      team: direct.team,
      routeType: direct.routeType,
      health: 'healthy',
      healthNote: direct.healthNote,
      workflowId: direct.workflowId,
      inboundPath: ['Twilio number', '/api/twiml-voice', `${direct.owner} mobile`, '/api/ivr/dial-result'],
      answeredPath: `Connects directly to ${direct.owner}; the call is recorded after answer.`,
      noAnswerPath: 'Dial result routes the caller to voicemail and records the missed outcome.',
      smsPath: 'Inbound SMS enters /api/twilio-sms-webhook and stays attached to this company number.',
      smsSenderPolicy: config.conversationEligible ? 'Approved for explicit conversation sends; the API validates and records the provider-confirmed sender.' : 'Reply-only identity; generic conversation sends are blocked.',
      outboundUse: config.dialerEligible
        ? 'Available as an approved conversation, broadcast, and dialer caller ID.'
        : 'Conversation reply only; excluded from broadcasts and dialer caller-ID rotation.',
      carrierFallback: 'Voice falls back to the owning agent and SMS is durably captured as New work when the primary Twilio webhook fails. Live carrier configuration is verified from this registry.',
      sourceFiles,
    }
  }

  const googleAds = GOOGLE_ADS_NUMBERS[config.value]
  if (googleAds) {
    return {
      number: config.value,
      label: config.label,
      purpose: config.purpose,
      owner: 'Acquisitions team',
      team: 'Acquisitions',
      routeType: 'google_ads',
      health: 'healthy',
      healthNote: `${googleAds.label} attribution is protected from generic outbound tools.`,
      workflowId: googleAds.workflowId,
      inboundPath: ['Twilio number', '/api/twiml-voice', '/api/ivr/google-ads', 'Ernest then Casey', 'Voicemail'],
      answeredPath: 'Rings the Google Ads acquisition route, records after answer, and preserves the tracking number.',
      noAnswerPath: 'Creates the missed-call recovery path and urgent return-call attention.',
      smsPath: 'Inbound SMS is attributed to the matching Google Ads line and notifies the acquisition team.',
      smsSenderPolicy: 'Reply-only for the matching inbound Google Ads path; blocked from generic conversations, broadcasts, and system sends.',
      outboundUse: 'Reserved for Google Ads attribution; blocked from generic conversations, broadcasts, and dialer rotation.',
      carrierFallback: 'Voice falls back to the acquisition owner and SMS is durably captured without losing the Google Ads tracking number. Live carrier configuration is verified from this registry.',
      sourceFiles: [...sourceFiles, '/api/ivr/google-ads', '/api/cron/google-ads-missed-calls'],
    }
  }

  if (COLD_CALLBACK_NUMBERS.has(config.value)) {
    return {
      number: config.value,
      label: config.label,
      purpose: config.purpose,
      owner: 'Acquisitions team',
      team: 'Acquisitions',
      routeType: 'cold_callback',
      health: 'healthy',
      healthNote: 'Callback identity and reply-from number remain the dialed number.',
      workflowId: 'cold-call-callback-flow',
      inboundPath: ['Twilio number', '/api/twiml-voice', 'Press-1 callback IVR', '/api/ivr/handle-input', 'Acquisitions team'],
      answeredPath: 'A seller who presses 1 is routed to the acquisition team and the call is recorded after answer.',
      noAnswerPath: 'No IVR input enters /api/ivr/cold-no-input, ends the call, and queues a same-number SMS follow-up.',
      smsPath: 'Replies enter /api/twilio-sms-webhook and remain associated with the callback number.',
      smsSenderPolicy: 'Approved for conversation, callback reply, and broadcast use; the API validates the selected sender.',
      outboundUse: 'Available for dialer, conversations, and approved broadcasts.',
      carrierFallback: 'Voice falls back to the route owner and SMS is durably captured with the callback number preserved. Live carrier configuration is verified from this registry.',
      sourceFiles: [...sourceFiles, '/api/ivr/handle-input', '/api/ivr/cold-no-input'],
    }
  }

  return {
    number: config.value,
    label: config.label,
    purpose: config.purpose,
    owner: 'Acquisitions team',
    team: 'Acquisitions',
    routeType: 'acquisitions_ivr',
    health: 'healthy',
    healthNote: 'Standard seller intake and acquisition routing.',
    workflowId: 'acquisitions-seller-call-flow',
    inboundPath: ['Twilio number', '/api/twiml-voice', 'Seller IVR', '/api/ivr/handle-input', 'Acquisitions team'],
    answeredPath: 'Seller inquiries ring the acquisition team and record the call after answer.',
    noAnswerPath: 'No input is logged and routed through the general no-input follow-up and voicemail path.',
    smsPath: 'Inbound SMS enters /api/twilio-sms-webhook, resolves identity, records the message, and updates attention.',
    smsSenderPolicy: 'Approved for conversation sends; the API validates the selected identity and records Twilio\'s actual sender.',
    outboundUse: config.dialerEligible
      ? 'Available for dialer, conversations, and approved broadcasts.'
      : 'Not available to the generic dialer rotation.',
    carrierFallback: 'Voice falls back to the route owner and SMS is durably captured as New work when the primary Twilio webhook fails. Live carrier configuration is verified from this registry.',
    sourceFiles,
  }
}

export const PHONE_SYSTEM = TWILIO_NUMBERS.map(routeFor) satisfies readonly PhoneSystemRecord[]

export const PHONE_SYSTEM_ATTENTION = PHONE_SYSTEM.filter((record) => record.health === 'attention')

export function findPhoneSystemRecord(number: string | null | undefined) {
  return PHONE_SYSTEM.find((record) => record.number === number)
}
