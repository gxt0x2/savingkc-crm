export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import sharp from 'sharp'

const BUCKET = 'deal-assets'

// POST /api/deals/import-photos
// Body: { deal_page_id, urls: string[] }
// Downloads each URL, converts to JPEG, uploads to Supabase Storage
export async function POST(req: NextRequest) {
  try {
    const { deal_page_id, urls } = await req.json()

    if (!deal_page_id || !urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: 'deal_page_id and urls[] are required' },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()

    // Verify deal page exists
    const { data: dealPage, error: dpError } = await db
      .from('deal_pages')
      .select('id, photos')
      .eq('id', deal_page_id)
      .single()

    if (dpError || !dealPage) {
      return NextResponse.json({ error: 'Deal page not found' }, { status: 404 })
    }

    // Ensure bucket exists
    const { data: buckets } = await db.storage.listBuckets()
    if (!buckets?.find(b => b.name === BUCKET)) {
      await db.storage.createBucket(BUCKET, { public: true })
    }

    const imported: string[] = []
    const errors: string[] = []

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      try {
        // Download the image
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'image/*,*/*',
          },
        })

        if (!res.ok) {
          errors.push(`[${i}] HTTP ${res.status} for ${url.substring(0, 80)}`)
          continue
        }

        const arrayBuffer = await res.arrayBuffer()
        const inputBuffer = Buffer.from(arrayBuffer)

        // Convert to JPEG using sharp (handles HEIC, PNG, WebP, TIFF, etc.)
        const jpegBuffer = await sharp(inputBuffer)
          .jpeg({ quality: 85, mozjpeg: true })
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .rotate() // auto-rotate based on EXIF
          .toBuffer()

        // Upload to Supabase Storage
        const timestamp = Date.now()
        const safeName = `${timestamp}_${i}.jpg`
        const path = `${deal_page_id}/photo/${safeName}`

        const { error: uploadError } = await db.storage
          .from(BUCKET)
          .upload(path, jpegBuffer, {
            contentType: 'image/jpeg',
            upsert: false,
          })

        if (uploadError) {
          errors.push(`[${i}] Upload failed: ${uploadError.message}`)
          continue
        }

        const { data: publicUrlData } = db.storage.from(BUCKET).getPublicUrl(path)
        imported.push(publicUrlData.publicUrl)
      } catch (err) {
        errors.push(`[${i}] ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Append new photos to existing photos array
    if (imported.length > 0) {
      const allPhotos = [...(dealPage.photos || []), ...imported]
      await db.from('deal_pages').update({ photos: allPhotos }).eq('id', deal_page_id)
    }

    return NextResponse.json({
      imported: imported.length,
      failed: errors.length,
      total_photos: (dealPage.photos || []).length + imported.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('[deals/import-photos] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
