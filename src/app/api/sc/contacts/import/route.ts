import { NextResponse } from 'next/server'
import { parse } from 'csv-parse/sync'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/** Contact fields a CSV column can map to. Anything else → custom_fields. */
const MAPPABLE_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'email',
  'address',
  'city',
  'state',
  'zip',
] as const

type MappableField = (typeof MAPPABLE_FIELDS)[number]

/**
 * POST /api/sc/contacts/import — multipart/form-data
 *   file:       CSV File
 *   has_header: "true" | "false"
 *   preview:    "true" → return { headers, sampleRows } only (no import)
 *   mapping:    JSON string { "<csv column>": "<contact field>" }
 *   group_name: create a new upload group with this name  (or)
 *   group_id:   add imported contacts to this existing group
 *
 * Returns { imported, skipped, suppressed, groupId, total }.
 */
export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing CSV file' }, { status: 400 })
  }

  const hasHeader = form.get('has_header') !== 'false'
  const text = await file.text()

  let rows: string[][]
  try {
    rows = parse(text, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][]
  } catch (e) {
    return NextResponse.json(
      { error: `CSV parse failed: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 400 },
    )
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'CSV is empty' }, { status: 400 })
  }

  const headers = hasHeader
    ? rows[0].map((h) => h.trim())
    : rows[0].map((_, i) => `column_${i + 1}`)
  const dataRows = hasHeader ? rows.slice(1) : rows

  // ---- Preview mode: just hand back headers + a sample so the UI can build mapping.
  if (form.get('preview') === 'true') {
    const sampleRows = dataRows.slice(0, 5).map((r) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => {
        obj[h] = r[i] ?? ''
      })
      return obj
    })
    return NextResponse.json({ headers, sampleRows })
  }

  // ---- Import mode.
  let mapping: Record<string, string> = {}
  const mappingRaw = form.get('mapping')
  if (typeof mappingRaw === 'string' && mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw)
    } catch {
      return NextResponse.json({ error: 'Invalid mapping JSON' }, { status: 400 })
    }
  }

  // Column index → target field (or null for custom_fields).
  const columnTargets: Array<MappableField | null> = headers.map((h) => {
    const target = mapping[h]
    return MAPPABLE_FIELDS.includes(target as MappableField)
      ? (target as MappableField)
      : null
  })
  const hasPhoneMapping = columnTargets.includes('phone')
  if (!hasPhoneMapping) {
    return NextResponse.json(
      { error: 'A CSV column must be mapped to "phone"' },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()

  // Load suppression list to skip opted-out numbers.
  const { data: optOuts } = await db
    .from('sms_opt_outs')
    .select('phone')
    .eq('is_opted_out', true)
  const suppressedSet = new Set(
    (optOuts || [])
      .map((o) => normalizePhoneToE164(o.phone))
      .filter((p): p is string => !!p),
  )

  const source = file.name || 'upload'
  let imported = 0
  let skipped = 0
  let suppressed = 0
  const importedIds: string[] = []
  const total = dataRows.length

  // Build rows, dedupe on phone within this file (last write wins).
  const byPhone = new Map<
    string,
    {
      first_name: string | null
      last_name: string | null
      phone: string
      email: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
      custom_fields: Record<string, string>
      source: string
      status: 'active'
    }
  >()

  for (const r of dataRows) {
    const record: Record<MappableField, string | null> = {
      first_name: null,
      last_name: null,
      phone: null,
      email: null,
      address: null,
      city: null,
      state: null,
      zip: null,
    }
    const custom: Record<string, string> = {}

    headers.forEach((h, i) => {
      const val = (r[i] ?? '').trim()
      const target = columnTargets[i]
      if (target) {
        record[target] = val || null
      } else if (val) {
        custom[h] = val
      }
    })

    const phone = normalizePhoneToE164(record.phone)
    if (!phone) {
      skipped++
      continue
    }
    if (suppressedSet.has(phone)) {
      suppressed++
      continue
    }

    byPhone.set(phone, {
      first_name: record.first_name,
      last_name: record.last_name,
      phone,
      email: record.email,
      address: record.address,
      city: record.city,
      state: record.state,
      zip: record.zip,
      custom_fields: custom,
      source,
      status: 'active',
    })
  }

  const contactRows = Array.from(byPhone.values())

  // Upsert in chunks to keep payloads reasonable.
  const CHUNK = 500
  for (let i = 0; i < contactRows.length; i += CHUNK) {
    const chunk = contactRows.slice(i, i + CHUNK)
    const { data, error } = await db
      .from('sc_contacts')
      .upsert(chunk, { onConflict: 'phone' })
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const c of data || []) importedIds.push(c.id)
    imported += chunk.length
  }

  // Resolve / create the target group.
  let groupId: string | null = null
  const groupName = form.get('group_name')
  const providedGroupId = form.get('group_id')
  if (typeof groupName === 'string' && groupName.trim()) {
    const { data: grp, error: grpErr } = await db
      .from('sc_groups')
      .insert({ name: groupName.trim(), source: 'upload' })
      .select()
      .single()
    if (grpErr) return NextResponse.json({ error: grpErr.message }, { status: 500 })
    groupId = grp.id
  } else if (typeof providedGroupId === 'string' && providedGroupId) {
    groupId = providedGroupId
  }

  if (groupId && importedIds.length) {
    const memberRows = importedIds.map((cid) => ({
      group_id: groupId as string,
      contact_id: cid,
    }))
    for (let i = 0; i < memberRows.length; i += CHUNK) {
      await db
        .from('sc_group_members')
        .upsert(memberRows.slice(i, i + CHUNK), {
          onConflict: 'group_id,contact_id',
          ignoreDuplicates: true,
        })
    }
    const { count } = await db
      .from('sc_group_members')
      .select('contact_id', { count: 'exact', head: true })
      .eq('group_id', groupId)
    await db
      .from('sc_groups')
      .update({ contact_count: count || 0 })
      .eq('id', groupId)
  }

  return NextResponse.json({ imported, skipped, suppressed, groupId, total })
}
