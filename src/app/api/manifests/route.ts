import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildManifest, type BuildManifestInput } from '@/lib/manifest-builder'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/manifests?lead_id=xxx or ?booking_id=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const leadId = searchParams.get('lead_id')
    const bookingId = searchParams.get('booking_id')

    if (!leadId && !bookingId) {
      return NextResponse.json(
        { error: 'lead_id or booking_id required' },
        { status: 400 }
      )
    }

    let query = supabase.from('manifests').select('*')

    if (leadId) {
      query = query.eq('lead_id', leadId)
    } else if (bookingId) {
      query = query.eq('booking_id', bookingId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Manifest query error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch manifest' },
        { status: 500 }
      )
    }

    // Return first manifest if found, or null
    return NextResponse.json({
      manifest: data && data.length > 0 ? data[0] : null,
    })
  } catch (err) {
    console.error('Manifests GET error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/manifests - Create new manifest
export async function POST(req: NextRequest) {
  try {
    const input: BuildManifestInput = await req.json()

    // Validate required fields
    if (!input.firstName || (!input.phone && !input.email)) {
      return NextResponse.json(
        { error: 'firstName and (phone or email) are required' },
        { status: 400 }
      )
    }

    // Build manifest object
    const manifest = buildManifest(input)

    // Insert into Supabase
    const { data, error } = await supabase
      .from('manifests')
      .insert({
        lead_id: input.leadId || null,
        booking_id: input.bookingId || null,
        version: manifest.version,
        manifest: manifest,
        current_station: manifest.currentStation,
        priority: manifest.priority,
        tier: manifest.tier,
        qualification_score: manifest.qualificationScore,
      })
      .select('id, manifest')
      .single()

    if (error) {
      console.error('Manifest insert error:', error)
      return NextResponse.json(
        { error: 'Failed to create manifest' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      manifest: data.manifest,
      id: data.id,
    })
  } catch (err) {
    console.error('Manifests POST error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
