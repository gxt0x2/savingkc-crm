import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Uses service role to create users (admin-only endpoint)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ADMIN_SECRET = process.env.CRON_SECRET || process.env.DEPLOY_SECRET

// Agent accounts to seed
const AGENTS = [
  {
    email: 'ernest@savingkc.com',
    password: 'SavingKC2026!',
    name: 'Ernest A. Dodson III',
    role: 'owner',
    phone: '+18162262552',
    assigned_twilio_number: '+18166088588',
  },
  {
    email: 'casey@savingkc.com',
    password: 'SavingKC2026!',
    name: 'Casey Davis',
    role: 'agent',
    phone: '+18167564943',
    assigned_twilio_number: '+18167277667',
  },
]

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret') || req.headers.get('x-admin-secret')
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results = []

  for (const agent of AGENTS) {
    // Check if user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(u => u.email === agent.email)

    if (existing) {
      results.push({ email: agent.email, status: 'already_exists', id: existing.id })
      continue
    }

    // Create user via admin API
    const { data, error } = await supabase.auth.admin.createUser({
      email: agent.email,
      password: agent.password,
      email_confirm: true, // Skip email confirmation
      user_metadata: {
        full_name: agent.name,
        role: agent.role,
        phone: agent.phone,
      },
    })

    if (error) {
      results.push({ email: agent.email, status: 'error', error: error.message })
    } else {
      results.push({ email: agent.email, status: 'created', id: data.user?.id })
    }
  }

  // Also create agent_profiles table entries
  for (const agent of AGENTS) {
    const { error } = await supabase.from('agent_profiles').upsert({
      email: agent.email,
      full_name: agent.name,
      role: agent.role,
      phone: agent.phone,
      assigned_twilio_number: agent.assigned_twilio_number,
      notification_prefs: { sms: true, push: true, email: false },
      office_hours: { start: '08:00', end: '17:00', timezone: 'America/Chicago' },
    }, { onConflict: 'email' })

    if (error && error.code !== 'PGRST205') {
      results.push({ email: agent.email, profile_status: 'error', error: error.message })
    }
  }

  return NextResponse.json({ results })
}
