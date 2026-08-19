import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { supabase } from '@/lib/supabase-lazy'

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.includes('@') ? normalized : null
}

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, 120) : null
}

export async function POST(req: NextRequest) {
  const actorEmail = normalizeEmail(await getCurrentUserEmail())
  if (!actorEmail) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    )
  }

  try {
    let body: Record<string, unknown>
    try {
      const parsed = await req.json() as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Valid JSON body required' }, { status: 400 })
    }

    if (Object.hasOwn(body, 'email')) {
      const requestedEmail = normalizeEmail(body.email)
      if (!requestedEmail) {
        return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
      }
      if (requestedEmail !== actorEmail) {
        return NextResponse.json({ error: 'Profile email must match the authenticated user' }, { status: 403 })
      }
    }

    const { data: existing, error: lookupError } = await supabase
      .from('agent_profiles')
      .select('id')
      .eq('email', actorEmail)
      .maybeSingle()

    if (lookupError) {
      console.error('link-profile lookup error:', lookupError)
      return NextResponse.json({ error: 'Unable to load profile' }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json({ linked: true, profileId: existing.id })
    }

    const fullName = cleanDisplayName(body.name) || actorEmail.split('@')[0]
    const { data: newProfile, error: createError } = await supabase
      .from('agent_profiles')
      .insert({
        email: actorEmail,
        full_name: fullName,
        role: 'agent',
        is_admin: false,
      })
      .select('id')
      .single()

    if (createError || !newProfile?.id) {
      console.error('link-profile create error:', createError)
      return NextResponse.json({ error: 'Unable to create profile' }, { status: 500 })
    }

    return NextResponse.json({ linked: true, profileId: newProfile.id, created: true })
  } catch (error) {
    console.error('link-profile error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
