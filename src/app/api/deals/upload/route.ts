export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const BUCKET = 'deal-assets'

const MAX_SIZES: Record<string, number> = {
  photo: 10 * 1024 * 1024,       // 10 MB
  video: 100 * 1024 * 1024,      // 100 MB
  inspection_report: 20 * 1024 * 1024, // 20 MB
}

const ALLOWED_TYPES: Record<string, string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  inspection_report: ['application/pdf'],
}

// POST /api/deals/upload
// FormData: file, deal_page_id, type (photo|video|inspection_report)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const dealPageId = formData.get('deal_page_id') as string | null
    const type = formData.get('type') as string | null

    if (!file || !dealPageId || !type) {
      return NextResponse.json(
        { error: 'file, deal_page_id, and type are required' },
        { status: 400 }
      )
    }

    if (!MAX_SIZES[type]) {
      return NextResponse.json(
        { error: 'type must be photo, video, or inspection_report' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZES[type]) {
      const maxMB = MAX_SIZES[type] / (1024 * 1024)
      return NextResponse.json(
        { error: `File too large. Max ${maxMB}MB for ${type}` },
        { status: 400 }
      )
    }

    const allowedMimes = ALLOWED_TYPES[type]
    if (!allowedMimes.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${allowedMimes.join(', ')}` },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()

    // Verify deal page exists
    const { data: dealPage, error: dpError } = await db
      .from('deal_pages')
      .select('id, photos, videos, inspection_reports')
      .eq('id', dealPageId)
      .single()

    if (dpError || !dealPage) {
      return NextResponse.json({ error: 'Deal page not found' }, { status: 404 })
    }

    // Ensure bucket exists (auto-create on first use)
    const { data: buckets } = await db.storage.listBuckets()
    if (!buckets?.find(b => b.name === BUCKET)) {
      await db.storage.createBucket(BUCKET, { public: true })
    }

    // Upload file
    const ext = file.name.split('.').pop() || 'bin'
    const timestamp = Date.now()
    const safeName = `${timestamp}.${ext}`
    const path = `${dealPageId}/${type}/${safeName}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[deals/upload] Upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })
    }

    // Get public URL
    const { data: publicUrlData } = db.storage.from(BUCKET).getPublicUrl(path)
    const url = publicUrlData.publicUrl

    // Update deal_pages row with the new asset
    if (type === 'photo') {
      const photos = [...(dealPage.photos || []), url]
      await db.from('deal_pages').update({ photos }).eq('id', dealPageId)
    } else if (type === 'video') {
      const videos = [...(dealPage.videos || []), url]
      await db.from('deal_pages').update({ videos }).eq('id', dealPageId)
    } else if (type === 'inspection_report') {
      const reports = [...(dealPage.inspection_reports || [])]
      reports.push({
        name: file.name,
        url,
        uploaded_at: new Date().toISOString(),
      })
      await db.from('deal_pages').update({ inspection_reports: reports }).eq('id', dealPageId)
    }

    return NextResponse.json({ url, path })
  } catch (err) {
    console.error('[deals/upload] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
