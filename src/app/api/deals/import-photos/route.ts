export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import sharp from 'sharp'

const BUCKET = 'deal-assets'
const GOOGLE_PHOTO_URL_PATTERN = /https?:\/\/lh[3-6]\.googleusercontent\.com\/[^"'\\\]\s<>]+/g

function decodeHtml(value: string): string {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/\\u002f/g, '/')
    .replace(/\\u003d/g, '=')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\\//g, '/')
    .replace(/\\x26/g, '&')
    .replace(/\\x3d/g, '=')
    .replace(/&amp;/g, '&')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function extractGooglePhotoUrls(html: string): string[] {
  const decoded = decodeHtml(html)
  const matches = decoded.match(GOOGLE_PHOTO_URL_PATTERN) ?? []

  return unique(matches)
    .map(normalizeGooglePhotoUrl)
    .filter(url => {
      try {
        const parsed = new URL(url)
        return parsed.hostname.endsWith('.googleusercontent.com') && parsed.pathname.startsWith('/pw/')
      } catch {
        return false
      }
    })
}

function isGooglePhotosShareUrl(sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname
    return hostname === 'photos.app.goo.gl' || hostname === 'photos.google.com'
  } catch {
    return false
  }
}

async function extractGooglePhotoUrlsWithBrowser(sourceUrl: string): Promise<string[]> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1600 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    })
    const discovered = new Set<string>()

    page.on('response', response => {
      const url = response.url()
      if (GOOGLE_PHOTO_URL_PATTERN.test(url)) {
        discovered.add(url)
        GOOGLE_PHOTO_URL_PATTERN.lastIndex = 0
      }
    })

    await page.goto(resolveSourceUrl(sourceUrl), { waitUntil: 'networkidle', timeout: 45000 })

    let lastCount = 0
    let stableRounds = 0

    for (let round = 0; round < 40; round++) {
      const urls = await page.evaluate(() => {
        const values = new Set<string>()
        const add = (value: string | null | undefined) => {
          if (!value) return
          if (value.includes('googleusercontent.com')) values.add(value)
        }

        document.querySelectorAll('img, source').forEach(el => {
          add(el.getAttribute('src'))
          add(el.getAttribute('data-src'))
          add(el.getAttribute('srcset'))
        })
        document.querySelectorAll('[style]').forEach(el => add(el.getAttribute('style')))
        document.querySelectorAll('a[href]').forEach(el => add(el.getAttribute('href')))
        performance.getEntriesByType('resource').forEach(entry => add(entry.name))

        return Array.from(values)
      })

      for (const value of urls) {
        for (const match of decodeHtml(value).match(GOOGLE_PHOTO_URL_PATTERN) ?? []) {
          discovered.add(match)
        }
      }

      if (discovered.size <= lastCount) {
        stableRounds += 1
      } else {
        stableRounds = 0
        lastCount = discovered.size
      }

      if (stableRounds >= 5) break
      await page.mouse.wheel(0, 2600)
      await page.waitForTimeout(900)
    }

    return unique(Array.from(discovered)).map(normalizeGooglePhotoUrl)
  } finally {
    await browser.close()
  }
}

function normalizeGooglePhotoUrl(url: string): string {
  const cleaned = decodeHtml(url)
    .replace(/&quot;.*/, '')
    .replace(/[),;]+$/, '')

  try {
    const parsed = new URL(cleaned)
    if (parsed.hostname.endsWith('.googleusercontent.com') && parsed.pathname.startsWith('/pw/')) {
      parsed.search = ''
      const basePath = parsed.pathname.replace(/=[^/]*$/, '')
      return `${parsed.origin}${basePath}=w2000-h2000-no`
    }
  } catch {
    return cleaned
  }

  return cleaned
}

function resolveSourceUrl(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl)
    if (parsed.hostname === 'photos.app.goo.gl' && !parsed.searchParams.has('_imcp')) {
      parsed.searchParams.set('_imcp', '1')
      return parsed.toString()
    }
  } catch {
    return sourceUrl
  }
  return sourceUrl
}

async function fetchImageBuffer(sourceUrl: string): Promise<{ buffer: Buffer; sourceUrls: string[] }> {
  const resolvedUrl = resolveSourceUrl(sourceUrl)
  const res = await fetch(resolvedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'image/*,text/html,*/*',
    },
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  const arrayBuffer = await res.arrayBuffer()
  const inputBuffer = Buffer.from(arrayBuffer)

  if (contentType.includes('text/html')) {
    const html = inputBuffer.toString('utf8')
    let extracted = extractGooglePhotoUrls(html)

    if (isGooglePhotosShareUrl(sourceUrl)) {
      try {
        const browserExtracted = await extractGooglePhotoUrlsWithBrowser(sourceUrl)
        extracted = unique([...extracted, ...browserExtracted])
      } catch (err) {
        console.warn('[deals/import-photos] Browser photo extraction failed:', err)
      }
    }

    if (extracted.length === 0) {
      throw new Error('URL returned a web page, not downloadable photos')
    }
    return { buffer: inputBuffer, sourceUrls: extracted }
  }

  return { buffer: inputBuffer, sourceUrls: [] }
}

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

    const queue = urls.map((url: string, sourceIndex: number) => ({ url, sourceIndex }))
    const seen = new Set<string>(queue.map((item: { url: string }) => item.url))

    for (let i = 0; i < queue.length; i++) {
      const { url, sourceIndex } = queue[i]
      try {
        const { buffer: inputBuffer, sourceUrls } = await fetchImageBuffer(url)
        if (sourceUrls.length > 0) {
          for (const sourceUrl of sourceUrls) {
            if (!seen.has(sourceUrl)) {
              seen.add(sourceUrl)
              queue.push({ url: sourceUrl, sourceIndex })
            }
          }
          continue
        }

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
        errors.push(`[${sourceIndex}] ${err instanceof Error ? err.message : String(err)} for ${url.substring(0, 80)}`)
      }
    }

    // Append new photos to existing photos array
    let allPhotos = dealPage.photos || []
    if (imported.length > 0) {
      allPhotos = [...(dealPage.photos || []), ...imported]
      await db.from('deal_pages').update({ photos: allPhotos }).eq('id', deal_page_id)
    }

    return NextResponse.json({
      imported: imported.length,
      failed: errors.length,
      total_photos: allPhotos.length,
      photos: allPhotos,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('[deals/import-photos] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
