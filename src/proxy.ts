import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { resolvePpcTrackingEndpoint } from '@/lib/ppc/tracking-endpoint'
import { previewWriteBlocked } from '@/lib/preview-safety'
import { hasVerifiedSubject } from '@/lib/auth/verified-claims'

// Routes that don't require authentication
const PUBLIC_PAGE_PREFIXES = ['/login', '/auth/callback', '/terms', '/privacy', '/deals', '/ppc']

// API routes that must remain reachable without a CRM session.
const PUBLIC_API_EXACT = new Set([
  '/api/availability',
  '/api/book',
  '/api/buyers/intake',
  '/api/leads',
  '/api/leads/ppc',
  '/api/leads/ppc/book',
  '/api/leads/ppc/track',
  '/api/ppc/track',
  '/api/google-maps-key',
  '/api/sell-edits',
  '/api/deals/image',
  '/api/deploy',
  '/api/docuseal/webhook',
  '/api/auth/google/authorize',
  '/api/auth/google/callback',
  '/api/auth/google-ads/authorize',
  '/api/maps/static',
  '/api/twiml-voice',
  '/api/twilio-sms-webhook',
  '/api/twilio-missed-call',
  '/api/twilio-recording-callback',
  '/api/twilio-call-status',
  // Carrier fallback routes are public Twilio webhooks and validate the
  // provider signature inside their handlers.
  '/api/twilio/fallback/voice',
  '/api/twilio/fallback/sms',
])

const PUBLIC_API_PREFIXES = [
  '/api/ivr/',
  '/api/audio/',
  '/api/mojo/',
  // Mobile routes validate Supabase bearer tokens inside route handlers.
  // Let CORS preflight and Authorization-bearing mobile requests reach them.
  '/api/mobile/',
]

// Routes that are guarded inside their route handlers by a shared server secret.
const TRUSTED_BEARER_API_PREFIXES = [
  '/api/admin/',
  '/api/workers/',
  '/api/eod',
  '/api/ari/',
  '/api/enrich/',
  '/api/cron/',
  '/api/hot-opportunities/cron',
]

const TRUSTED_BEARER_API_EXACT = new Set([
  '/api/deals/import-photos',
  '/api/deals/upload',
])

const HEALTH_CHECK_PATHS = new Set([
  '/dialer',
  '/api/twilio-token',
])

const TRUSTED_BEARER_SECRETS = [
  process.env.ADMIN_API_SECRET,
  process.env.CRON_SECRET,
  process.env.DEPLOY_SECRET,
  process.env.TWILIO_HEALTH_BEARER,
  process.env.EDGE_HEALTH_BEARER,
].filter((secret): secret is string => Boolean(secret?.trim()))

const TEST_BYPASS_SECRET = process.env.AUTH_PROXY_TEST_BYPASS_SECRET?.trim() || ''

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function hasTrustedBearer(request: NextRequest): boolean {
  const token = bearerToken(request.headers.get('authorization'))
  return Boolean(token && TRUSTED_BEARER_SECRETS.includes(token))
}

function hasTestBypass(request: NextRequest): boolean {
  return Boolean(
    TEST_BYPASS_SECRET &&
    process.env.VERCEL_ENV !== 'production' &&
    request.headers.get('x-skc-test-auth-bypass') === TEST_BYPASS_SECRET
  )
}

function isPublicDealApi(request: NextRequest): boolean {
  const { pathname } = request.nextUrl
  const parts = pathname.split('/').filter(Boolean)

  if (parts[0] !== 'api' || parts[1] !== 'deals') return false

  // GET /api/deals/:slug is public read-only deal data.
  if (parts.length === 3) {
    return request.method === 'GET' || request.method === 'OPTIONS'
  }

  if (parts.length === 4) {
    const action = parts[3]
    if (action === 'test-inspection-report') {
      return request.method === 'GET' || request.method === 'OPTIONS'
    }

    return action === 'events' || action === 'offer' || action === 'session'
  }

  return false
}

function isPublicApiRoute(request: NextRequest): boolean {
  const { pathname } = request.nextUrl

  if (PUBLIC_API_EXACT.has(pathname)) return true
  if (PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))) return true
  if (isPublicDealApi(request)) return true

  return false
}

function isTrustedBearerRoute(request: NextRequest): boolean {
  const { pathname } = request.nextUrl

  if (!hasTrustedBearer(request)) return false

  return (
    HEALTH_CHECK_PATHS.has(pathname) ||
    TRUSTED_BEARER_API_EXACT.has(pathname) ||
    TRUSTED_BEARER_API_PREFIXES.some(prefix => pathname.startsWith(prefix))
  )
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/logo') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/audio') ||
    /\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|mp3|wav)$/.test(pathname)
  )
}

function loginRedirect(request: NextRequest) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(loginUrl)
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

const PAID_LANDING_PATHS = new Set([
  '/ppc',
  '/ppc/',
  '/ppc-openai',
  '/ppc-openai/',
  '/ppc-tax',
  '/ppc-tax/',
  '/ppc-redemption',
  '/ppc-redemption/',
  '/ppc-excess-proceeds',
  '/ppc-excess-proceeds/',
])
const ATTRIBUTION_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'keyword',
  'matchtype',
  'campaignid',
  'adgroupid',
  'gclid',
  'gbraid',
  'wbraid',
  'oppref',
  'gad_source',
  'gad_campaignid',
  'gad_adgroupid',
  'skc_openai_click_id',
] as const

const OPENAI_CLICK_COOKIE = '__skc_openai_click_id'
const PPC_ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

type PaidLandingCookie = {
  name: string
  value: string
  maxAge: number
  secure: boolean
}

function isPaidLandingPageRequest(request: NextRequest): boolean {
  return request.method === 'GET' && PAID_LANDING_PATHS.has(request.nextUrl.pathname)
}

function cleanText(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined
}

function readAttributionFromRequest(request: NextRequest): Record<string, string> {
  const params = request.nextUrl.searchParams
  const attribution: Record<string, string> = {}

  for (const key of ATTRIBUTION_QUERY_KEYS) {
    const value = cleanText(params.get(key))
    if (value) attribution[key] = value
  }

  const cookieOppref = cleanText(request.cookies.get('__oppref')?.value)
  if (cookieOppref && !attribution.oppref) attribution.oppref = cookieOppref

  const cookieOpenAIClickId = cleanText(request.cookies.get(OPENAI_CLICK_COOKIE)?.value)
  if (cookieOpenAIClickId && !attribution.skc_openai_click_id) attribution.skc_openai_click_id = cookieOpenAIClickId

  return attribution
}

function makeOpenAIClickId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `skc_openai_${crypto.randomUUID()}`
  return `skc_openai_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function hasGoogleAdsSignal(attribution: Record<string, string>): boolean {
  return Boolean(
    attribution.gclid ||
    attribution.gbraid ||
    attribution.wbraid ||
    attribution.gad_source ||
    attribution.gad_campaignid ||
    attribution.gad_adgroupid ||
    attribution.utm_source?.toLowerCase().includes('google') ||
    attribution.utm_medium?.toLowerCase() === 'cpc',
  )
}

function isOpenAIAdsLandingPath(request: NextRequest): boolean {
  return request.nextUrl.pathname === '/ppc-openai' || request.nextUrl.pathname === '/ppc-openai/'
}

function hasOpenAIAdsSignal(request: NextRequest, attribution: Record<string, string>): boolean {
  const source = attribution.utm_source?.toLowerCase() ?? ''
  const medium = attribution.utm_medium?.toLowerCase() ?? ''
  const campaign = attribution.utm_campaign?.toLowerCase() ?? ''
  const referrer = request.headers.get('referer')?.toLowerCase() ?? ''
  const url = request.nextUrl.href.toLowerCase()

  return Boolean(
    isOpenAIAdsLandingPath(request) ||
    attribution.oppref ||
    attribution.skc_openai_click_id ||
    source.includes('openai') ||
    source.includes('chatgpt') ||
    medium.includes('openai') ||
    campaign.includes('openai') ||
    referrer.includes('chatgpt.com') ||
    referrer.includes('openai.com') ||
    url.includes('utm_source=openai'),
  )
}

function hasFreshOpenAIAdsSignal(request: NextRequest, attribution: Record<string, string>): boolean {
  const source = attribution.utm_source?.toLowerCase() ?? ''
  const medium = attribution.utm_medium?.toLowerCase() ?? ''
  const campaign = attribution.utm_campaign?.toLowerCase() ?? ''
  const referrer = request.headers.get('referer')?.toLowerCase() ?? ''
  const url = request.nextUrl.href.toLowerCase()

  return Boolean(
    isOpenAIAdsLandingPath(request) ||
    attribution.oppref ||
    source.includes('openai') ||
    source.includes('chatgpt') ||
    medium.includes('openai') ||
    campaign.includes('openai') ||
    referrer.includes('chatgpt.com') ||
    referrer.includes('openai.com') ||
    url.includes('utm_source=openai') ||
    url.includes('utm_source=chatgpt'),
  )
}

function campaignForPaidLanding(request: NextRequest, attribution: Record<string, string>, trafficSource?: string): string {
  if (attribution.utm_campaign) return attribution.utm_campaign
  if (trafficSource === 'openai_ads') return 'OpenAI Ads'
  if (request.nextUrl.pathname.startsWith('/ppc-excess-proceeds')) return 'Search - Excess Proceeds'
  if (request.nextUrl.pathname.startsWith('/ppc-redemption')) return 'Search - Redemption'
  if (request.nextUrl.pathname.startsWith('/ppc-tax')) return 'Search - Property Tax'
  return 'Search 2026'
}

function forwardedTrackingHeaders(request: NextRequest): Headers {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const name of [
    'user-agent',
    'accept-language',
    'x-forwarded-for',
    'x-vercel-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'sec-ch-ua-platform',
    'sec-ch-ua-mobile',
  ]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

function queuePaidLandingRequest(request: NextRequest, event: NextFetchEvent): PaidLandingCookie[] {
  const attribution = readAttributionFromRequest(request)
  const openaiAds = hasOpenAIAdsSignal(request, attribution)
  const googleAds = hasGoogleAdsSignal(attribution)
  const trafficSource = openaiAds ? 'openai_ads' : googleAds ? 'google_ads' : undefined
  const cookies: PaidLandingCookie[] = []
  if (openaiAds && !attribution.oppref) {
    const shouldMintFreshClickId = hasFreshOpenAIAdsSignal(request, attribution) || !attribution.skc_openai_click_id
    attribution.skc_openai_click_id = shouldMintFreshClickId
      ? makeOpenAIClickId()
      : attribution.skc_openai_click_id
    cookies.push({
      name: OPENAI_CLICK_COOKIE,
      value: attribution.skc_openai_click_id,
      maxAge: PPC_ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
      secure: request.nextUrl.protocol === 'https:',
    })
  }
  const eventId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `server_ppc_landing_request_${crypto.randomUUID()}`
    : `server_ppc_landing_request_${Date.now()}_${Math.random().toString(36).slice(2)}`

  event.waitUntil(
    fetch(resolvePpcTrackingEndpoint(request.nextUrl), {
      method: 'POST',
      headers: forwardedTrackingHeaders(request),
      body: JSON.stringify({
        eventId,
        eventName: 'ppc_landing_request',
        eventCategory: 'visit',
        eventTime: new Date().toISOString(),
        pagePath: request.nextUrl.pathname,
        pageLocation: request.nextUrl.href,
        pageReferrer: cleanText(request.headers.get('referer')),
        trafficSource,
        campaign: campaignForPaidLanding(request, attribution, trafficSource),
        attribution: {
          ...attribution,
          referrer: cleanText(request.headers.get('referer')),
          landingUrl: request.nextUrl.href,
        },
        payload: {
          server_side: true,
          paid_signal: openaiAds || googleAds,
          paid_source_detected: trafficSource ?? 'unknown',
        },
      }),
    }).catch((error) => {
      console.warn('[proxy] paid landing tracking failed', error)
    }),
  )

  return cookies
}

function withPaidLandingCookies(response: NextResponse, cookies: PaidLandingCookie[]): NextResponse {
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: false,
      sameSite: 'lax',
      secure: cookie.secure,
      path: '/',
      maxAge: cookie.maxAge,
    })
  }
  return response
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  let paidLandingCookies: PaidLandingCookie[] = []

  if (isPaidLandingPageRequest(request)) {
    paidLandingCookies = queuePaidLandingRequest(request, event)
  }

  if (previewWriteBlocked(request.method, pathname)) {
    return NextResponse.json(
      {
        error: 'Preview is read-only until a staging database is connected.',
        previewReadOnly: true,
      },
      { status: 403 },
    )
  }

  if (hasTestBypass(request)) {
    return withPaidLandingCookies(NextResponse.next(), paidLandingCookies)
  }

  // Skip auth for public routes
  if (PUBLIC_PAGE_PREFIXES.some(route => pathname.startsWith(route))) {
    return withPaidLandingCookies(NextResponse.next(), paidLandingCookies)
  }

  // Skip auth for explicitly public API routes and external webhooks
  if (isPublicApiRoute(request)) {
    return withPaidLandingCookies(NextResponse.next(), paidLandingCookies)
  }

  // Let server-to-server checks through only when they carry a trusted bearer.
  if (isTrustedBearerRoute(request)) {
    return withPaidLandingCookies(NextResponse.next(), paidLandingCookies)
  }

  // Skip auth for static files and Next.js internals
  if (isStaticAsset(pathname)) {
    return withPaidLandingCookies(NextResponse.next(), paidLandingCookies)
  }
  // Create Supabase client and refresh session
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // The project uses an asymmetric ES256 signing key, so getClaims verifies
  // the session locally after the cached JWKS lookup. getUser always calls the
  // regional Auth server and made every page prefetch/navigation block on a
  // redundant network round-trip.
  const claimsResult = await supabase.auth.getClaims()

  // If the signed token has no verified subject, keep the existing deny path.
  if (!hasVerifiedSubject(claimsResult)) {
    if (pathname.startsWith('/api/')) {
      return withPaidLandingCookies(unauthorized(), paidLandingCookies)
    }

    return withPaidLandingCookies(loginRedirect(request), paidLandingCookies)
  }

  return withPaidLandingCookies(supabaseResponse, paidLandingCookies)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|audio/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)',
  ],
}
