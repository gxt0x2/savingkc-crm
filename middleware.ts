import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/auth/callback']

// API routes that are called by external services (Twilio, GitHub, cron)
const WEBHOOK_PREFIXES = [
  '/api/twilio-sms-webhook',
  '/api/twilio-missed-call',
  '/api/twiml-voice',
  '/api/ivr/',
  '/api/mojo/',
  '/api/deploy',
  '/api/book',
  '/api/push/subscribe',
  '/api/push/test',
  '/api/admin/',
  '/api/workers/',
  '/api/eod',
  '/api/ari/',
  '/api/availability',
  '/api/setup-twilio',
  '/api/error',
  '/api/auth/setup',
  '/api/leads/ensure-manifest',
  '/api/leads/create-appointment',
  '/api/leads/appointment-outcome',
  '/api/dashboard/appointment-stats',
  '/api/hot-opportunities',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip auth for public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Skip auth for webhook/external API routes
  if (WEBHOOK_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // Skip auth for static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/logo') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/audio') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|mp3|wav)$/)
  ) {
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
    // For API routes, return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|audio/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)',
  ],
}
