import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')
  const all = searchParams.get('all')

  try {
    if (all === 'true') {
      const { data, error } = await supabase
        .from('agent_profiles')
        .select('*')
        .order('role', { ascending: true })

      if (error) {
        return NextResponse.json({ profiles: [] })
      }
      return NextResponse.json({ profiles: data || [] })
    }

    if (email) {
      const { data, error } = await supabase
        .from('agent_profiles')
        .select('*')
        .eq('email', email)
        .single()

      if (!error && data) {
        return NextResponse.json({ profile: data })
      }

      // Fallback: try matching by name from email prefix (e.g. ernest@... → Ernest)
      const nameGuess = email.split('@')[0].replace(/[^a-zA-Z]/g, '')
      if (nameGuess) {
        const { data: allProfiles } = await supabase
          .from('agent_profiles')
          .select('*')

        if (allProfiles) {
          const match = allProfiles.find((p: any) => {
            const profileName = (p.full_name || '').toLowerCase()
            return profileName.includes(nameGuess.toLowerCase())
          })
          if (match) {
            return NextResponse.json({ profile: match })
          }
        }
      }

      return NextResponse.json({ profile: null })
    }

    return NextResponse.json({ profile: null })
  } catch {
    return NextResponse.json({ profile: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, ...updates } = body

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 })
    }

    console.log('[Settings] Saving profile for:', email)
    console.log('[Settings] Updates:', Object.keys(updates))

    const { data, error } = await supabase
      .from('agent_profiles')
      .update(updates)
      .eq('email', email)
      .select()

    if (error) {
      console.error('[Settings] Save error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      console.error('[Settings] No rows updated - profile not found for email:', email)
      return NextResponse.json({ success: false, error: `Profile not found for ${email}` }, { status: 404 })
    }

    console.log('[Settings] Successfully updated profile for:', email)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Settings] POST error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
