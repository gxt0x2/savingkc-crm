export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

const ALLOWED_HOST = 'fprrknfyzlthbxewnwmi.supabase.co'
const ALLOWED_PREFIX = '/storage/v1/object/public/deal-assets/'

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const src = searchParams.get('src') || ''
  const width = intParam(searchParams.get('w'), 1200, 80, 2200)
  const quality = intParam(searchParams.get('q'), 82, 50, 90)

  let sourceUrl: URL
  try {
    sourceUrl = new URL(src)
  } catch {
    return NextResponse.json({ error: 'invalid image url' }, { status: 400 })
  }

  if (
    sourceUrl.protocol !== 'https:' ||
    sourceUrl.hostname !== ALLOWED_HOST ||
    !sourceUrl.pathname.startsWith(ALLOWED_PREFIX)
  ) {
    return NextResponse.json({ error: 'image source not allowed' }, { status: 400 })
  }

  try {
    const upstream = await fetch(sourceUrl, {
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*,*/*' },
      cache: 'force-cache',
      next: { revalidate: 60 * 60 * 24 * 30 },
    })

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'source image fetch failed' },
        { status: upstream.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      return NextResponse.json(
        { error: 'source is not an image' },
        { status: 415, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const input = Buffer.from(await upstream.arrayBuffer())
    const output = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer()

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    console.error('[deals/image] image proxy failed:', err)
    return NextResponse.json(
      { error: 'image proxy failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
