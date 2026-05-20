import { Icon } from '@/components/ui/icon'

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate'

type Step = {
  title: string
  timing: string
  detail: string
  code: string
}

type Journey = {
  id: string
  title: string
  entry: string
  status: string
  owner: string
  icon: string
  tone: Tone
  steps: Step[]
  data: string[]
  triggers: string[]
  notifications: string[]
  failure: string
}

const toneClasses: Record<Tone, { badge: string; icon: string; line: string; soft: string }> = {
  green: {
    badge: 'bg-emerald-500/12 text-emerald-300 border-emerald-400/25',
    icon: 'bg-emerald-500/15 text-emerald-300',
    line: 'border-emerald-400/30',
    soft: 'bg-emerald-500/10',
  },
  amber: {
    badge: 'bg-amber-500/12 text-amber-200 border-amber-400/25',
    icon: 'bg-amber-500/15 text-amber-200',
    line: 'border-amber-400/30',
    soft: 'bg-amber-500/10',
  },
  red: {
    badge: 'bg-[#E32E2E]/15 text-red-200 border-[#E32E2E]/30',
    icon: 'bg-[#E32E2E]/15 text-red-200',
    line: 'border-[#E32E2E]/35',
    soft: 'bg-[#E32E2E]/10',
  },
  blue: {
    badge: 'bg-blue-500/12 text-blue-200 border-blue-400/25',
    icon: 'bg-blue-500/15 text-blue-200',
    line: 'border-blue-400/30',
    soft: 'bg-blue-500/10',
  },
  slate: {
    badge: 'bg-slate-500/12 text-slate-200 border-slate-400/20',
    icon: 'bg-slate-500/15 text-slate-200',
    line: 'border-slate-400/20',
    soft: 'bg-slate-500/10',
  },
}

const journeys: Journey[] = [
  {
    id: 'ppc-form',
    title: 'PPC Form Lead',
    entry: 'savingkc.com/ppc from Search 2026 or paid-click URL',
    status: 'Live and conversion-gated',
    owner: 'Marketing to CRM',
    icon: 'ads_click',
    tone: 'green',
    steps: [
      {
        title: 'Paid click lands on the quiz',
        timing: 'Page load',
        detail: 'GTM loads through gtm.savingkc.com. Attribution reads click IDs and UTMs, then stores the first-touch payload in sessionStorage.',
        code: 'src/lib/ppc/attribution.ts',
      },
      {
        title: 'Quiz progress is tracked',
        timing: 'Step 1 and 2',
        detail: 'Step changes post best-effort progress to the PPC lead API. Google Ads/GA4 progress events fire for quiz started and quiz qualified.',
        code: 'src/app/(public)/ppc/SellLanding.tsx',
      },
      {
        title: 'Lead is written to CRM',
        timing: 'Final submit',
        detail: 'The API dedupes by phone, email, then address, enriches city/state/county from the address, writes a lead, creates or updates a manifest, and stamps acquisition attribution.',
        code: 'src/app/api/leads/ppc/route.ts',
      },
      {
        title: 'Conversion fires only after CRM success',
        timing: 'After leadId and manifestId',
        detail: 'Lead submitted is gated on a durable CRM response. If the CRM write fails, the page does not show success and the lead-submit conversion does not fire.',
        code: 'src/lib/ppc/conversions.ts',
      },
      {
        title: 'Enrichment starts',
        timing: 'Immediately after manifest exists',
        detail: 'Auto-enrichment looks for matching prospect data and county/property signals. The lead enters the CRM as hot for ASAP sellers and warm for slower timelines.',
        code: 'src/lib/auto-enrich.ts',
      },
    ],
    data: [
      'Name, phone, email, property address',
      'Situation, timeline, property condition',
      'gclid, gbraid/wbraid, UTMs, referrer, landing URL',
      'County parse, CRM source, priority, station',
      'Manifest acquisition payload and seller/property fields',
    ],
    triggers: [
      'lead_quiz_started value 1',
      'lead_quiz_qualified value 5',
      'lead_submitted value 25 after CRM success',
      'Manifest cascade and hot-engine invalidation if priority changes',
      'Auto-enrichment from prospect and county sources',
    ],
    notifications: [
      'No explicit team SMS is sent by the PPC form route today',
      'Lead appears in CRM queues through the lead row and manifest cascade',
      'Push/SMS alert should be added if every paid form lead needs immediate human notification',
    ],
    failure: 'If insert or manifest write fails, the API returns an error and keeps an emergency local queue line. The conversion is intentionally blocked.',
  },
  {
    id: 'ppc-booking',
    title: 'PPC Appointment Booking',
    entry: 'Book a 15-min call after PPC form success',
    status: 'CRM write live, Ads offline conversion stubbed',
    owner: 'Marketing to Calendar',
    icon: 'event_available',
    tone: 'blue',
    steps: [
      {
        title: 'Booking opens with identifiers',
        timing: 'After form submit',
        detail: 'The booking URL receives source=ppc-landing and the manifestId so appointment data can be tied back to the paid lead.',
        code: 'src/app/(public)/ppc/SellLanding.tsx',
      },
      {
        title: 'Webhook resolves the lead',
        timing: 'Booking webhook',
        detail: 'The handler accepts manifestId or leadId, resolves the CRM lead, then updates the manifest with scheduled date and time.',
        code: 'src/app/api/leads/ppc/book/route.ts',
      },
      {
        title: 'Lead is escalated',
        timing: 'Same webhook',
        detail: 'The manifest moves to appointment-booked and priority hot, then cascades back to the lead snapshot.',
        code: 'src/lib/manifest-sync.ts',
      },
      {
        title: 'High-value conversion is deferred',
        timing: 'After manifest update',
        detail: 'The handler logs the Google Ads appointment_booked payload, but the real Offline Conversions API call is still waiting on Google Ads API credentials.',
        code: 'src/app/api/leads/ppc/book/route.ts',
      },
    ],
    data: [
      'Manifest ID, lead ID, booking ID',
      'Scheduled date and time',
      'Attendee name, email, phone when sent by booking provider',
      'Stored gclid from original PPC attribution',
    ],
    triggers: [
      'Manifest station update to appointment-booked',
      'Priority set hot',
      'Future server-side Google Ads appointment_booked conversion value 100',
    ],
    notifications: [
      'No dedicated booking SMS alert is visible in this webhook today',
      'Calendar or booking-provider notifications may happen outside this handler',
    ],
    failure: 'Webhook returns a hard error if no lead or manifest identifier can be resolved, or if the manifest cascade fails.',
  },
  {
    id: 'google-ads-call',
    title: 'Google Ads Phone Call',
    entry: '(816) 608-8808 from Google Ads or website call tracking',
    status: 'Tracking live, CRM route currently falls into standard IVR',
    owner: 'Paid Search to Phone',
    icon: 'phone_callback',
    tone: 'amber',
    steps: [
      {
        title: 'Website call tracking renders the PPC number',
        timing: 'Page load',
        detail: 'Google calls-from-website tracking is active and requests use displayed number 8166088808 for eligible ad-click traffic.',
        code: 'src/app/(public)/ppc/GoogleAdsTag.tsx',
      },
      {
        title: 'Inbound Twilio call enters voice handler',
        timing: 'Call start',
        detail: 'The voice route checks outbound client calls, direct-ring company numbers, cold-call callback numbers, then standard inbound IVR.',
        code: 'src/app/api/twiml-voice/route.ts',
      },
      {
        title: 'Current behavior is standard IVR',
        timing: 'If called number is not a direct-ring number',
        detail: 'The dedicated PPC number is not in DIRECT_RING_NUMBERS in this route today, so it receives the normal greeting and Gather flow unless Twilio forwards it to another company number.',
        code: 'src/app/api/twiml-voice/route.ts',
      },
      {
        title: 'Seller presses 1',
        timing: 'During IVR',
        detail: 'The handler finds or creates a hot lead, uses prospect lookup when possible, logs a call activity, ensures a manifest, and sim-rings both agents.',
        code: 'src/app/api/ivr/handle-input/route.ts',
      },
      {
        title: 'Call is answered or missed',
        timing: 'After Dial',
        detail: 'Dial result logs connected calls. If nobody answers, it sends agent SMS alerts, creates a 5-minute callback task, sends a delayed caller text, and redirects to voicemail.',
        code: 'src/app/api/ivr/dial-result/route.ts',
      },
    ],
    data: [
      'Caller number, called number, call SID, dial status',
      'Matched or created lead ID',
      'Lead source inbound_ivr unless special routing is added',
      'Call activities, task metadata, recording callback IDs',
      'Manifest priority and communication signals',
    ],
    triggers: [
      'Google Ads phone conversion request for website number',
      'Twilio Gather digit 1 or 2',
      'Sim-ring both agents with whisper',
      'Recording status callback',
      'Missed-call task and follow-up SMS',
    ],
    notifications: [
      'Live call rings both agents after seller intent is captured',
      'If missed, both agents receive SMS for IVR seller calls',
      'Caller receives delayed apology/follow-up SMS if not opted out and not rate-limited',
      'Direct paid-search bypass and paid-search-specific SMS templates are not implemented in the route today',
    ],
    failure: 'Emergency fallback rings Ernest if the main TwiML handler throws. If agents miss the call, caller is routed to voicemail.',
  },
  {
    id: 'standard-inbound',
    title: 'Standard Inbound IVR',
    entry: 'Main company number or non-paid inbound call',
    status: 'Live',
    owner: 'Inbound Phone',
    icon: 'call_split',
    tone: 'green',
    steps: [
      {
        title: 'Greeting asks for intent',
        timing: 'Call start',
        detail: 'Standard inbound plays the IVR greeting and gathers one digit.',
        code: 'src/app/api/twiml-voice/route.ts',
      },
      {
        title: 'Press 1 creates seller path',
        timing: 'Digit 1',
        detail: 'Existing leads are bumped hot. Unknown callers are matched against prospect data or inserted as new hot inbound_ivr leads.',
        code: 'src/app/api/ivr/handle-input/route.ts',
      },
      {
        title: 'Press 2 stays non-lead',
        timing: 'Digit 2',
        detail: 'The call is logged as a non-seller inquiry without creating a lead, then agents are dialed.',
        code: 'src/app/api/ivr/handle-input/route.ts',
      },
      {
        title: 'No input still captures caller',
        timing: 'Timeout',
        detail: 'Repeat no-input spam is filtered. Otherwise the system finds or creates a normal-priority inbound_ivr_no_input lead, logs the call, then rings agents.',
        code: 'src/app/api/ivr/no-input/route.ts',
      },
      {
        title: 'Dial result closes the loop',
        timing: 'After ring attempt',
        detail: 'Connected calls are logged. Missed calls create critical callback tasks and delayed SMS, then route to voicemail.',
        code: 'src/app/api/ivr/dial-result/route.ts',
      },
    ],
    data: [
      'Digit pressed or no-input tag',
      'Phone match, prospect lookup result, lead source',
      'Call activity metadata and lead task metadata',
      'Manifest existence and priority',
      'Recording callback data when call is recorded',
    ],
    triggers: [
      'Lead creation for seller or no-input paths',
      'Manifest creation',
      'Agent sim-ring',
      'Callback task if missed',
      'Voicemail redirect if missed',
    ],
    notifications: [
      'Whisper before agent connection',
      'Agent SMS when both agents miss',
      'Delayed caller SMS after missed IVR calls',
    ],
    failure: 'Invalid input replays the main voice route. Critical handler errors use emergency ring or voicemail fallback.',
  },
  {
    id: 'direct-company-line',
    title: 'Direct Company Line',
    entry: 'Ernest or Casey company number',
    status: 'Live direct-ring path',
    owner: 'Agent-Owned Lines',
    icon: 'phone_in_talk',
    tone: 'blue',
    steps: [
      {
        title: 'Direct number is recognized',
        timing: 'Call start',
        detail: 'Two company numbers bypass IVR and dial the owning agent cell directly.',
        code: 'src/app/api/twiml-voice/route.ts',
      },
      {
        title: 'Agent hears whisper',
        timing: 'Before connection',
        detail: 'The Number verb uses the whisper route with direct-call context before bridging.',
        code: 'src/app/api/ivr/whisper/route.ts',
      },
      {
        title: 'Connected call is logged',
        timing: 'Answered',
        detail: 'Dial result resolves the lead by ID or phone and logs a direct inbound connection.',
        code: 'src/app/api/ivr/dial-result/route.ts',
      },
      {
        title: 'Missed direct call alerts owner only',
        timing: 'No answer',
        detail: 'The owning agent receives a missed-direct SMS. Direct calls do not create caller auto-texts or callback tasks in this path.',
        code: 'src/app/api/ivr/dial-result/route.ts',
      },
    ],
    data: [
      'Called company number',
      'Owning agent route',
      'Caller phone and optional matched lead',
      'Dial status and duration',
    ],
    triggers: [
      'Direct Dial to owning agent',
      'Recording callback',
      'Owner-only missed SMS',
    ],
    notifications: [
      'Owning agent cell rings immediately',
      'Owner gets missed SMS if not answered',
      'No automatic caller SMS on direct missed calls',
    ],
    failure: 'The direct path falls back to general emergency handling if TwiML generation fails.',
  },
  {
    id: 'cold-callback',
    title: 'Cold Call Callback',
    entry: 'Seller calls back a cold-call outbound number',
    status: 'Live specialized IVR',
    owner: 'Outbound to Inbound',
    icon: 'settings_phone',
    tone: 'slate',
    steps: [
      {
        title: 'Cold number is detected',
        timing: 'Call start',
        detail: 'Known cold-call outbound numbers use a shorter qualify-before-ring IVR instead of the normal greeting.',
        code: 'src/app/api/twiml-voice/route.ts',
      },
      {
        title: 'Press 1 becomes hot seller intent',
        timing: 'Digit 1',
        detail: 'The system creates or finds the lead with cold_call_callback source, marks it hot, logs the call, ensures a manifest, and rings agents.',
        code: 'src/app/api/ivr/handle-input/route.ts',
      },
      {
        title: 'No input or press 2 gets passive follow-up',
        timing: 'No seller confirmation',
        detail: 'The callback is logged. Existing leads can be warmed. A delayed 60-120 second SMS asks for a YES reply, and agents are not rung.',
        code: 'src/app/api/ivr/cold-no-input/route.ts',
      },
      {
        title: 'Missed ring follows IVR missed-call path',
        timing: 'If press 1 and nobody answers',
        detail: 'Dial result creates missed-call alerts, a callback task, delayed caller text, and voicemail redirect.',
        code: 'src/app/api/ivr/dial-result/route.ts',
      },
    ],
    data: [
      'Cold campaign called number',
      'Caller phone and prospect match',
      'Lead source cold_call_callback',
      'Callback activity and SMS dedup metadata',
      'Priority hot or warm depending on intent',
    ],
    triggers: [
      'Cold-call IVR',
      'Lead creation from prospect match',
      'Delayed YES-reply SMS',
      'Agent ring only after press 1',
    ],
    notifications: [
      'No agent ring unless caller presses 1',
      'Delayed caller SMS on no-input or not-interested path',
      'Standard missed IVR alerts if press 1 call is missed',
    ],
    failure: 'Cold no-input handler falls back to a graceful hangup if it cannot write or text.',
  },
  {
    id: 'missed-status',
    title: 'Missed Call Status Automation',
    entry: 'Twilio status callback no-answer or busy',
    status: 'Live, with known/unknown branches',
    owner: 'Ari and Follow-up',
    icon: 'notification_important',
    tone: 'red',
    steps: [
      {
        title: 'Status callback is validated',
        timing: 'Every call status event',
        detail: 'Twilio signature and rate limit checks run before any lead automation. Internal team numbers and direct-ring parent events are ignored.',
        code: 'src/app/api/twilio-missed-call/route.ts',
      },
      {
        title: 'Known lead missed call',
        timing: 'No-answer or busy',
        detail: 'The lead is marked hot, Ari/manifest communication signals are updated, an intelligent missed-call SMS may be sent, and both agents are alerted.',
        code: 'src/app/api/twilio-missed-call/route.ts',
      },
      {
        title: 'Unknown caller missed call',
        timing: 'No matching lead',
        detail: 'The system searches prospect phones, creates an enriched lead when possible or a bare hot missed-call lead, then links the already-logged call activity.',
        code: 'src/app/api/twilio-missed-call/route.ts',
      },
      {
        title: 'Ari work is created',
        timing: 'After lead resolution',
        detail: 'The handler creates Ari briefing events, push notifications, team SMS alerts, and a critical callback task due in five minutes.',
        code: 'src/app/api/twilio-missed-call/route.ts',
      },
    ],
    data: [
      'Call SID, status, duration, caller and destination',
      'Known lead match or newly created lead',
      'Missed-call SMS variant and agent routing',
      'Ari briefing event and callback task metadata',
      'Manifest communication event',
    ],
    triggers: [
      'Priority hot on known missed leads',
      'Prospect lookup for unknown callers',
      'Caller SMS if opted-in and rate-limited OK',
      'Both-agent SMS and push notification',
      'Five-minute critical callback task',
    ],
    notifications: [
      'Known lead: both agents get hot-lead missed-call SMS and push',
      'Unknown caller: both agents get unknown missed-call SMS and push',
      'Caller can receive an intelligent auto-text after the configured delay',
    ],
    failure: 'If validation fails, the request is rejected. If downstream work throws, the route returns an error and logs the status callback failure.',
  },
]

const operationalGaps = [
  {
    title: 'Dedicated PPC phone fast path',
    detail: '+1 816 608 8808 is tracked for Google Ads, but the CRM voice route does not yet special-case it as a direct paid-search path.',
    next: 'Add it to a paid-search routing branch with google_ads_phone source tagging, direct ring, and PPC-specific missed-call templates.',
  },
  {
    title: 'Immediate PPC form team alert',
    detail: 'The paid form creates the CRM lead and manifest, but does not currently send team SMS or push at final submit.',
    next: 'Add owner/team notification after leadId and manifestId are confirmed.',
  },
  {
    title: 'Durable failed-lead queue',
    detail: 'Failed PPC writes are conversion-gated now, but the fallback queue is local emergency storage.',
    next: 'Move failed payloads to a database dead-letter table with alerting and replay status.',
  },
  {
    title: 'Appointment offline conversion',
    detail: 'The appointment_booked Google Ads conversion is logged as a stub until Google Ads API credentials are provisioned.',
    next: 'Wire the Offline Conversions API with the stored gclid and booking timestamp.',
  },
]

function FieldList({ title, icon, items }: { title: string; icon: string; items: string[] }) {
  return (
    <section className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--ck-text-muted)]">
        <Icon name={icon} size="text-base" className="text-[#E32E2E]" />
        {title}
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-5 text-[var(--ck-text)]">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#E32E2E]" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function JourneyPanel({ journey }: { journey: Journey }) {
  const tone = toneClasses[journey.tone]

  return (
    <article className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-sm overflow-hidden">
      <header className="border-b border-[var(--ck-border)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-4">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
              <Icon name={journey.icon} size="text-2xl" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black tracking-tight text-[var(--ck-text)]">{journey.title}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.13em] ${tone.badge}`}>
                  {journey.status}
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-[var(--ck-text-muted)]">{journey.entry}</p>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-xs text-[var(--ck-text-muted)]">
            <span className="font-black uppercase tracking-[0.13em] text-[var(--ck-text-dim)]">Owner</span>
            <div className="mt-1 font-bold text-[var(--ck-text)]">{journey.owner}</div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <section className="space-y-4">
          {journey.steps.map((step, index) => (
            <div key={step.title} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
              <div className="relative flex justify-center">
                <div className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black ${tone.badge}`}>
                  {index + 1}
                </div>
                {index < journey.steps.length - 1 && (
                  <div className={`absolute top-8 h-[calc(100%+1rem)] border-l ${tone.line}`} />
                )}
              </div>
              <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-black text-[var(--ck-text)]">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--ck-text-muted)]">{step.detail}</p>
                  </div>
                  <span className="inline-flex w-fit flex-shrink-0 rounded-md border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--ck-text-dim)]">
                    {step.timing}
                  </span>
                </div>
                <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md bg-black/20 px-2.5 py-1.5 text-[11px] font-bold text-[var(--ck-text-muted)]">
                  <Icon name="code" size="text-sm" className="text-[var(--ck-text-dim)]" />
                  <span className="truncate">{step.code}</span>
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="space-y-4">
          <FieldList title="Data Gathered" icon="database" items={journey.data} />
          <FieldList title="Triggers" icon="bolt" items={journey.triggers} />
          <FieldList title="Notifications" icon="notifications_active" items={journey.notifications} />
          <section className={`rounded-lg border border-[var(--ck-border)] ${tone.soft} p-4`}>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--ck-text-muted)]">
              <Icon name="error" size="text-base" className="text-[#E32E2E]" />
              Failure Path
            </div>
            <p className="text-sm leading-6 text-[var(--ck-text)]">{journey.failure}</p>
          </section>
        </aside>
      </div>
    </article>
  )
}

export default function JourneysPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 pb-24 sm:px-6 lg:px-8">
      <header className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-[#E32E2E]">
              Operations map
            </span>
            <h1 className="text-3xl font-black tracking-tight text-[var(--ck-text)]">Lead Journeys</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--ck-text-muted)]">
              Code-backed view of how prospects move from form submission or inbound call into CRM records, manifests, activities, tasks, notifications, tracking, and follow-up.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
              <div className="text-2xl font-black text-[var(--ck-text)]">{journeys.length}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">Journeys</div>
            </div>
            <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
              <div className="text-2xl font-black text-[var(--ck-text)]">5</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">Call paths</div>
            </div>
            <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
              <div className="text-2xl font-black text-[var(--ck-text)]">4</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">Open gaps</div>
            </div>
            <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
              <div className="text-2xl font-black text-[var(--ck-text)]">May 20</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">Updated</div>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-4">
        {operationalGaps.map((gap) => (
          <div key={gap.title} className="rounded-lg border border-[#E32E2E]/25 bg-[#E32E2E]/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-black text-red-100">
              <Icon name="priority_high" size="text-lg" className="text-[#E32E2E]" />
              {gap.title}
            </div>
            <p className="text-sm leading-5 text-[var(--ck-text-muted)]">{gap.detail}</p>
            <p className="mt-3 border-t border-[#E32E2E]/20 pt-3 text-xs font-bold leading-5 text-red-100">{gap.next}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {journeys.map((journey) => {
          const tone = toneClasses[journey.tone]
          return (
            <a
              key={journey.id}
              href={`#${journey.id}`}
              className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4 shadow-sm transition-colors hover:border-[#E32E2E]/45"
            >
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
                  <Icon name={journey.icon} size="text-xl" />
                </div>
                <div className="min-w-0">
                  <div className="font-black text-[var(--ck-text)]">{journey.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ck-text-muted)]">{journey.entry}</div>
                </div>
              </div>
            </a>
          )
        })}
      </section>

      <section className="space-y-6">
        {journeys.map((journey) => (
          <div key={journey.id} id={journey.id} className="scroll-mt-24">
            <JourneyPanel journey={journey} />
          </div>
        ))}
      </section>
    </div>
  )
}
