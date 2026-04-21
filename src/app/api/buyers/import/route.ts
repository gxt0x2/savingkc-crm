export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line, respecting quoted fields that may contain commas.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside quoted field
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/**
 * Normalize raw phone to E.164 (+1XXXXXXXXXX).
 * Returns null if not a valid US number.
 */
function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1)}`
  return null
}

// ---------------------------------------------------------------------------
// POST /api/buyers/import
// Accept FormData with `file` field (CSV), parse and batch-insert buyers
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'file field required (CSV)' }, { status: 400 })
    }

    const text = await (file as File).text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 })
    }

    // Parse header
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'))

    const col = (row: string[], name: string): string | undefined => {
      const idx = headers.indexOf(name)
      return idx !== -1 ? row[idx] || undefined : undefined
    }

    // Gather existing phones + emails for dedup
    const { data: existingBuyers } = await supabaseAdmin()
      .from('buyers')
      .select('phone, email')

    const existingPhones = new Set<string>()
    const existingEmails = new Set<string>()
    for (const b of existingBuyers ?? []) {
      if (b.phone) existingPhones.add(b.phone)
      if (b.email) existingEmails.add(b.email.toLowerCase())
    }

    const toInsert: Record<string, unknown>[] = []
    let skipped = 0
    const errors: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i])
      const lineNum = i + 1

      try {
        const rawPhone = col(row, 'phone')
        const email = col(row, 'email')?.toLowerCase() || null
        const phone = normalizePhone(rawPhone)

        // Deduplicate against existing buyers
        if (phone && existingPhones.has(phone)) {
          skipped++
          continue
        }
        if (email && existingEmails.has(email)) {
          skipped++
          continue
        }

        // Deduplicate within the current import batch
        if (phone && toInsert.some((b) => b.phone === phone)) {
          skipped++
          continue
        }
        if (email && toInsert.some((b) => b.email === email)) {
          skipped++
          continue
        }

        const first_name = col(row, 'first_name')
        const last_name = col(row, 'last_name')

        if (!first_name && !last_name) {
          errors.push(`Line ${lineNum}: first_name and last_name are both empty — skipped`)
          skipped++
          continue
        }

        // Parse buy_box fields
        const rawZips = col(row, 'zip_codes')
        const zip_codes = rawZips ? rawZips.split(';').map((z) => z.trim()).filter(Boolean) : []

        const rawTypes = col(row, 'property_types')
        const property_types = rawTypes ? rawTypes.split(';').map((t) => t.trim()).filter(Boolean) : []

        const rawPriceMin = col(row, 'price_min')
        const rawPriceMax = col(row, 'price_max')
        const price_min = rawPriceMin ? parseFloat(rawPriceMin) : undefined
        const price_max = rawPriceMax ? parseFloat(rawPriceMax) : undefined

        const rawNotes = col(row, 'notes')

        const buy_box = {
          ...(zip_codes.length > 0 ? { zip_codes } : {}),
          ...(property_types.length > 0 ? { property_types } : {}),
          ...(price_min !== undefined && !isNaN(price_min) ? { price_min } : {}),
          ...(price_max !== undefined && !isNaN(price_max) ? { price_max } : {}),
        }

        const rawFunding = col(row, 'funding_type')
        const validFunding = ['cash', 'hard_money', 'private_money', 'conventional']
        const funding_type = rawFunding && validFunding.includes(rawFunding) ? rawFunding : null

        toInsert.push({
          first_name: first_name || '',
          last_name: last_name || '',
          company_name: col(row, 'company_name') || null,
          email,
          phone,
          buy_box: Object.keys(buy_box).length > 0 ? buy_box : null,
          funding_type,
          notes: rawNotes || null,
          tier: 'new',
          status: 'active',
          source: 'csv_import',
        })

        // Track for intra-batch dedup
        if (phone) existingPhones.add(phone)
        if (email) existingEmails.add(email)
      } catch (rowErr) {
        errors.push(`Line ${lineNum}: ${rowErr instanceof Error ? rowErr.message : 'Parse error'}`)
        skipped++
      }
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped,
        errors,
        message: 'No new buyers to import',
      })
    }

    // Batch insert in chunks of 500 to avoid payload limits
    const CHUNK_SIZE = 500
    let imported = 0

    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE)
      const { error: insertError, count } = await supabaseAdmin()
        .from('buyers')
        .insert(chunk, { count: 'exact' })

      if (insertError) {
        console.error('[buyers/import] Insert error:', insertError)
        errors.push(`Batch insert failed: ${insertError.message}`)
        skipped += chunk.length
      } else {
        imported += count ?? chunk.length
      }
    }

    return NextResponse.json({ imported, skipped, errors })
  } catch (err) {
    console.error('[buyers/import] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
