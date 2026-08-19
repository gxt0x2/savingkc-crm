import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { supabase } from '@/lib/supabase-lazy'
import { findTwilioNumber } from '@/lib/twilio-numbers'

const SELF_EDITABLE_PROFILE_FIELDS = new Set([
  'full_name',
  'phone',
  'profile_photo_url',
  'voicemail_greeting',
  'voicemail_recording_url',
  'after_hours_behavior',
  'notification_prefs',
  'office_hours',
])

const MANAGER_EDITABLE_PROFILE_FIELDS = new Set([
  ...SELF_EDITABLE_PROFILE_FIELDS,
  'assigned_twilio_number',
])

type ActorProfile = {
  role: string | null
  is_admin: boolean | null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.includes('@') ? normalized : null
}

async function loadActorProfile(email: string): Promise<ActorProfile | null> {
  const { data } = await supabase
    .from('agent_profiles')
    .select('role, is_admin')
    .eq('email', email)
    .maybeSingle()

  return data as ActorProfile | null
}

function canManageProfiles(profile: ActorProfile | null): boolean {
  return Boolean(profile?.is_admin || profile?.role === 'owner')
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const actorEmail = await getCurrentUserEmail()
  if (!actorEmail) return unauthorized()

  const { searchParams } = new URL(req.url)
  const requestedEmail = normalizeEmail(searchParams.get('email'))
  const wantsAllProfiles = searchParams.get('all') === 'true'

  try {
    const actorProfile = await loadActorProfile(actorEmail)
    const canManage = canManageProfiles(actorProfile)

    if (wantsAllProfiles) {
      if (!canManage) return forbidden()

      const { data, error } = await supabase
        .from('agent_profiles')
        .select('email, full_name, role, is_admin, profile_photo_url')
        .order('role', { ascending: true })

      if (error) {
        return NextResponse.json({ profiles: [] }, { status: 500 })
      }
      return NextResponse.json({ profiles: data || [] })
    }

    const targetEmail = requestedEmail || actorEmail
    if (targetEmail !== actorEmail && !canManage) return forbidden()

    const { data, error } = await supabase
      .from('agent_profiles')
      .select('*')
      .eq('email', targetEmail)
      .single()

    if (!error && data) {
      return NextResponse.json({ profile: data })
    }

    return NextResponse.json({ profile: null })
  } catch {
    return NextResponse.json({ profile: null }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const actorEmail = await getCurrentUserEmail()
  if (!actorEmail) return unauthorized()

  try {
    const body = await req.json()
    const targetEmail = normalizeEmail(body?.email)
    if (!targetEmail) {
      return NextResponse.json({ success: false, error: 'Valid email required' }, { status: 400 })
    }

    const actorProfile = await loadActorProfile(actorEmail)
    const canManage = canManageProfiles(actorProfile)
    if (targetEmail !== actorEmail && !canManage) return forbidden()

    const updates = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'email'),
    )

    if (Object.hasOwn(updates, 'assigned_twilio_number') && !canManage) {
      return NextResponse.json(
        { success: false, error: 'Only an owner or admin can change the assigned Twilio number' },
        { status: 403 },
      )
    }

    const editableFields = canManage ? MANAGER_EDITABLE_PROFILE_FIELDS : SELF_EDITABLE_PROFILE_FIELDS
    const disallowedFields = Object.keys(updates).filter((key) => !editableFields.has(key))
    if (disallowedFields.length > 0) {
      return NextResponse.json(
        { success: false, error: `Profile fields cannot be changed here: ${disallowedFields.join(', ')}` },
        { status: 400 },
      )
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'No profile updates provided' }, { status: 400 })
    }

    if (Object.hasOwn(updates, 'assigned_twilio_number')) {
      const requestedNumber = updates.assigned_twilio_number
      if (requestedNumber === null || requestedNumber === '') {
        updates.assigned_twilio_number = null
      } else {
        const approvedNumber = typeof requestedNumber === 'string'
          ? findTwilioNumber(requestedNumber)
          : undefined
        const isReserved = approvedNumber && 'reservedFor' in approvedNumber && Boolean(approvedNumber.reservedFor)
        if (!approvedNumber?.dialerEligible || isReserved) {
          return NextResponse.json(
            { success: false, error: 'Assigned Twilio number must be an approved outbound calling number' },
            { status: 400 },
          )
        }
        updates.assigned_twilio_number = approvedNumber.value
      }
    }

    console.info('[Settings] Profile update', {
      actorEmail,
      targetEmail,
      fields: Object.keys(updates),
    })

    const { data, error } = await supabase
      .from('agent_profiles')
      .update(updates)
      .eq('email', targetEmail)
      .select()

    if (error) {
      console.error('[Settings] Save error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, error: `Profile not found for ${targetEmail}` }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Settings] POST error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
