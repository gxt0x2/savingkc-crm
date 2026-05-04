export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

interface NominatimPlace {
  lat: string
  lon: string
  display_name?: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')?.trim()

  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  try {
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      q: address,
    })

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        'User-Agent': 'SavingKC CRM map lookup (https://crm.savingkc.com)',
        'Accept': 'application/json',
      },
      next: { revalidate: 60 * 60 * 24 * 30 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Geocode failed: HTTP ${res.status}` }, { status: 502 })
    }

    const places = (await res.json()) as NominatimPlace[]
    const place = places[0]
    const lat = Number(place?.lat)
    const lon = Number(place?.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 })
    }

    return NextResponse.json(
      { lat, lon, display_name: place.display_name ?? null },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800',
        },
      }
    )
  } catch (err) {
    console.error('[maps/geocode] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
