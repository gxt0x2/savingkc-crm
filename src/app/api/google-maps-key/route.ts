import { NextResponse } from 'next/server'

const KEY_ENV_NAMES = [
  'NEXT_PUBLIC_GMAPS_KEY',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_KEY',
  'GMAPS_KEY',
  'MAPS_API_KEY',
]

function getMapsKey(): string {
  for (const name of KEY_ENV_NAMES) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

export async function GET() {
  const key = getMapsKey()
  if (!key) {
    return NextResponse.json(
      { error: 'Google Maps key is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { key },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } },
  )
}
