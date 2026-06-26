import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

interface ConversationTagRecord {
  id: string
  label: string
  color: string
  archived?: boolean
  updated_at?: string
}

const TAG_CONFIG_KEY = 'conversation_tag_catalog'
const DEFAULT_TAGS: ConversationTagRecord[] = [
  { id: 'call_scheduled', label: 'Call Scheduled', color: '#42A5F5' },
  { id: 'voicemail', label: 'Voicemail', color: '#F7B955' },
  { id: 'too_high', label: 'Too High', color: '#7D9BFF' },
  { id: 'buyer', label: 'Buyer', color: '#8D7DFF' },
  { id: 'sold', label: 'Sold', color: '#B8C2CC' },
  { id: 'closed_deal', label: 'Closed Deal', color: '#EF4D6D' },
  { id: 'under_contract', label: 'Under Contract', color: '#F7B955' },
  { id: 'realtor_referral', label: 'Realtor Referral', color: '#72D398' },
  { id: 'appointment_made', label: 'Appointment Made', color: '#26C6DA' },
]
const DEFAULT_TAG_MAP = new Map(DEFAULT_TAGS.map((tag) => [tag.id, tag]))
const TAG_COLOR_FALLBACKS = ['#42A5F5', '#F7B955', '#72D398', '#EF4D6D', '#8D7DFF', '#B8C2CC']

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanTagId(value: unknown): string | null {
  const raw = cleanText(value)
  if (!raw) return null
  const normalized = raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || null
}

function tagLabel(tagId: string): string {
  return tagId
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function cleanColor(value: unknown, index = 0): string {
  const raw = cleanText(value)
  if (raw && /^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase()
  return TAG_COLOR_FALLBACKS[index % TAG_COLOR_FALLBACKS.length]
}

function parseStoredTags(value: unknown): unknown[] {
  if (!value) return []
  const parsed = typeof value === 'string' ? safeJson(value) : value
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tags?: unknown }).tags)) {
    return (parsed as { tags: unknown[] }).tags
  }
  return []
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeTagRecord(value: unknown, index = 0): ConversationTagRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = cleanTagId(record.id || record.label)
  if (!id) return null
  const label = cleanText(record.label) || DEFAULT_TAG_MAP.get(id)?.label || tagLabel(id)
  const color = cleanColor(record.color || DEFAULT_TAG_MAP.get(id)?.color, index)
  return {
    id,
    label,
    color,
    archived: record.archived === true,
    updated_at: cleanText(record.updated_at) || undefined,
  }
}

function mergeWithDefaults(storedValue: unknown): ConversationTagRecord[] {
  const map = new Map<string, ConversationTagRecord>()
  DEFAULT_TAGS.forEach((tag) => map.set(tag.id, { ...tag }))
  parseStoredTags(storedValue).forEach((raw, index) => {
    const tag = normalizeTagRecord(raw, index)
    if (tag) map.set(tag.id, { ...map.get(tag.id), ...tag })
  })
  return Array.from(map.values())
}

function activeTags(tags: ConversationTagRecord[]): ConversationTagRecord[] {
  return tags.filter((tag) => !tag.archived)
}

async function readCatalog(): Promise<ConversationTagRecord[]> {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', TAG_CONFIG_KEY)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message)
  }
  return mergeWithDefaults(data?.value)
}

async function writeCatalog(tags: ConversationTagRecord[]) {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: TAG_CONFIG_KEY,
      value: JSON.stringify({ tags }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

  if (error) throw new Error(error.message)
}

async function upsertTag(req: Request) {
  const body = await req.json().catch(() => ({}))
  const id = cleanTagId(body?.id || body?.label)
  if (!id) {
    return NextResponse.json({ error: 'Tag label is required' }, { status: 400 })
  }

  const catalog = await readCatalog()
  const existingIndex = catalog.findIndex((tag) => tag.id === id)
  const existing = existingIndex >= 0 ? catalog[existingIndex] : null
  const tag: ConversationTagRecord = {
    id,
    label: cleanText(body?.label) || existing?.label || tagLabel(id),
    color: cleanColor(body?.color || existing?.color, catalog.length),
    archived: false,
    updated_at: new Date().toISOString(),
  }

  const nextCatalog = existingIndex >= 0
    ? catalog.map((item) => (item.id === id ? tag : item))
    : [...catalog, tag]
  await writeCatalog(nextCatalog)

  return NextResponse.json({ tag, tags: activeTags(nextCatalog) })
}

export async function GET() {
  try {
    const catalog = await readCatalog()
    return NextResponse.json({ tags: activeTags(catalog) })
  } catch (err) {
    console.error('[conversations/tags] GET error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    return await upsertTag(req)
  } catch (err) {
    console.error('[conversations/tags] POST error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    return await upsertTag(req)
  } catch (err) {
    console.error('[conversations/tags] PATCH error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = new URL(req.url)
    const id = cleanTagId(body?.id || url.searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ error: 'Tag id is required' }, { status: 400 })
    }

    const catalog = await readCatalog()
    const found = catalog.some((tag) => tag.id === id)
    const nextCatalog = found
      ? catalog.map((tag) => (tag.id === id ? { ...tag, archived: true, updated_at: new Date().toISOString() } : tag))
      : catalog
    if (found) await writeCatalog(nextCatalog)

    return NextResponse.json({ deleted: found, tags: activeTags(nextCatalog) })
  } catch (err) {
    console.error('[conversations/tags] DELETE error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}
