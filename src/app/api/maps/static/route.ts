export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')?.trim()
  const width = Math.min(Math.max(Number(searchParams.get('w')) || 640, 120), 640)
  const height = Math.min(Math.max(Number(searchParams.get('h')) || 640, 120), 640)
  const zoom = Math.min(Math.max(Number(searchParams.get('z')) || 17, 1), 20)
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GMAPS_KEY

  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  if (!key) {
    return NextResponse.json({ error: 'Google Maps API key is not configured' }, { status: 501 })
  }

  const params = new URLSearchParams({
    center: address,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: '2',
    format: 'png32',
    maptype: 'roadmap',
    markers: `color:red|${address}`,
    key,
  })

  const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, {
    headers: { Accept: 'image/png,image/*,*/*' },
    cache: 'no-store',
  })

  if (!res.ok) {
    const message = await res.text().catch(() => '')
    return NextResponse.json(
      { error: 'Google Static Maps request failed', detail: message.slice(0, 240) },
      { status: res.status, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800',
    },
  })
}
