import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (hasTestBypass(request)) {
    return NextResponse.next()
  }

  // Skip auth for public routes
  if (PUBLIC_PAGE_PREFIXES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Skip auth for explicitly public API routes and external webhooks
  if (isPublicApiRoute(request)) {
    return NextResponse.next()
  }

  // Let server-to-server checks through only when they carry a trusted bearer.
  if (isTrustedBearerRoute(request)) {
    return NextResponse.next()
  }

  // Skip auth for static files and Next.js internals
  if (isStaticAsset(pathname)) {
    return NextResponse.next()
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

  const { data: { user } } = await supabase.auth.getUser()

  // If no user and trying to access protected route, redirect to login
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return unauthorized()
    }

    return loginRedirect(request)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|audio/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)',
  ],
}
