import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { email, name, phone } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }

    // Check if profile with this email already exists
    const { data: existing } = await supabase
      .from('agent_profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (existing) {
      return NextResponse.json({ linked: true, profileId: existing.id })
    }

    // Try to match by name (fuzzy)
    if (name) {
      const { data: profiles } = await supabase
        .from('agent_profiles')
        .select('id, full_name, email')

      if (profiles) {
        const normalizedName = name.toLowerCase().trim()
        const match = profiles.find((p: any) => {
          const profileName = (p.full_name || '').toLowerCase().trim()
          return profileName === normalizedName ||
            profileName.includes(normalizedName) ||
            normalizedName.includes(profileName)
        })

        if (match) {
          await supabase
            .from('agent_profiles')
            .update({ email })
            .eq('id', match.id)
          return NextResponse.json({ linked: true, profileId: match.id, matched: 'name' })
        }
      }
    }

    // Try to match by phone
    if (phone) {
      const { data: phoneMatch } = await supabase
        .from('agent_profiles')
        .select('id')
        .eq('phone', phone)
        .single()

      if (phoneMatch) {
        await supabase
          .from('agent_profiles')
          .update({ email })
          .eq('id', phoneMatch.id)
        return NextResponse.json({ linked: true, profileId: phoneMatch.id, matched: 'phone' })
      }
    }

    // No match — create a new profile
    const { data: newProfile } = await supabase
      .from('agent_profiles')
      .insert({
        email,
        full_name: name || email.split('@')[0],
        role: 'agent',
      })
      .select('id')
      .single()

    return NextResponse.json({ linked: true, profileId: newProfile?.id, created: true })
  } catch (err: any) {
    console.error('link-profile error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
