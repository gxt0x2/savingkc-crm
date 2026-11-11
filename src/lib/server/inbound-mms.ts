import { INBOUND_MMS_BUCKET } from '@/lib/inbound-mms-view'
import {
  isSupportedMessageAttachmentMime,
  messageAttachmentExtension,
  safeMobileAttachmentFilename,
} from '@/lib/mobile-api/message-attachments'
import { supabase } from '@/lib/supabase-lazy'

export { INBOUND_MMS_BUCKET }

export const INBOUND_MMS_MAX_BYTES = 5 * 1024 * 1024
const MAX_MEDIA = 10

const EXTRA_EXTENSION: Record<string, string> = {
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'audio/amr': 'amr',
  'audio/3gpp': '3gp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'text/vcard': 'vcf',
}

const REDIRECT_HOSTS = new Set(['api.twilio.com', 'media.twiliocdn.com'])

export class InboundMmsInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundMmsInputError'
  }
}

export interface TwilioMediaRef {
  index: number
  url: string
  contentType: string
}

export interface StoredInboundMms {
  index: number
  storage_bucket: typeof INBOUND_MMS_BUCKET
  storage_path: string
  content_type: string
  byte_size: number
}

export interface CapturedInboundMms {
  description: string
  metadata: { num_media: number; mms: StoredInboundMms[] }
}

type Upload = (path: string, bytes: Uint8Array, contentType: string) => Promise<void>

export function inboundSmsDisplayBody(body: string | null | undefined, mediaCount: number): string {
  const text = (body ?? '').trim()
  if (text) return text
  if (mediaCount === 1) return 'Sent a photo'
  if (mediaCount > 1) return `Sent ${mediaCount} photos`
  return ''
}

export function readTwilioInboundMedia(form: FormData): TwilioMediaRef[] {
  const raw = form.get('NumMedia')
  if (raw === null || raw === '') return []
  const count = Number(raw)
  if (!Number.isInteger(count) || count < 0 || count > MAX_MEDIA) {
    throw new InboundMmsInputError('Invalid NumMedia')
  }
  const items: TwilioMediaRef[] = []
  for (let index = 0; index < count; index += 1) {
    const url = String(form.get(`MediaUrl${index}`) || '').trim()
    const contentType = String(form.get(`MediaContentType${index}`) || '').split(';')[0].trim().toLowerCase()
    if (!url) throw new InboundMmsInputError('Missing Twilio media URL')
    items.push({ index, url, contentType })
  }
  return items
}

function assertTwilioMediaUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new InboundMmsInputError('Invalid Twilio media URL')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.twilio.com' || !parsed.pathname.includes('/Media/')) {
    throw new InboundMmsInputError('Refusing non-Twilio media URL')
  }
  return parsed
}

function allowedRedirect(next: URL): boolean {
  if (next.protocol !== 'https:') return false
  return REDIRECT_HOSTS.has(next.hostname) || next.hostname.endsWith('.twilio.com') || next.hostname.endsWith('.twiliocdn.com')
}

function twilioAuthorization(): string {
  const key = process.env.TWILIO_API_KEY
  const secret = process.env.TWILIO_API_SECRET
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (key && secret) return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`
  if (sid && token) return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
  throw new Error('Twilio media download is not configured')
}

function storedContentType(downloaded: string, declared: string): string {
  const responseType = downloaded.split(';')[0].trim().toLowerCase()
  const declaredType = declared === 'image/jpg' ? 'image/jpeg' : declared
  const candidate = responseType === 'image/jpg' ? 'image/jpeg' : responseType
  if (isSupportedMessageAttachmentMime(candidate) || EXTRA_EXTENSION[candidate]) return candidate
  if (isSupportedMessageAttachmentMime(declaredType) || EXTRA_EXTENSION[declaredType]) return declaredType
  throw new Error('Unsupported inbound MMS type')
}

function mediaFilename(index: number, contentType: string): string {
  const extension = messageAttachmentExtension(contentType)
  if (extension) return `${index}-${safeMobileAttachmentFilename(`mms-${index}`, contentType)}`
  const extra = EXTRA_EXTENSION[contentType]
  if (!extra) throw new Error('Unsupported inbound MMS type')
  return `${index}-mms.${extra}`
}

function storedFromMetadata(metadata: Record<string, unknown> | null | undefined, expected: number): StoredInboundMms[] | null {
  if (!metadata || !Array.isArray(metadata.mms) || metadata.mms.length !== expected) return null
  const items: StoredInboundMms[] = []
  for (const item of metadata.mms) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (row.storage_bucket !== INBOUND_MMS_BUCKET || typeof row.storage_path !== 'string') return null
    if (typeof row.content_type !== 'string' || typeof row.byte_size !== 'number' || typeof row.index !== 'number') return null
    if (/^https?:/i.test(row.storage_path)) return null
    items.push({
      index: row.index,
      storage_bucket: INBOUND_MMS_BUCKET,
      storage_path: row.storage_path,
      content_type: row.content_type,
      byte_size: row.byte_size,
    })
  }
  return items
}

async function downloadTwilioMedia(url: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  let current = assertTwilioMediaUrl(url)
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchImpl(current.toString(), {
      headers: { Authorization: twilioAuthorization() },
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Twilio media redirect missing location')
      const next = new URL(location, current)
      if (!allowedRedirect(next)) throw new Error('Twilio media redirect left the provider')
      current = next
      continue
    }
    if (!response.ok) throw new Error(`Twilio media download failed (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 1 || bytes.byteLength > INBOUND_MMS_MAX_BYTES) {
      throw new Error('Twilio media is outside the storage size limit')
    }
    return { bytes, contentType: response.headers.get('content-type') || '' }
  }
  throw new Error('Twilio media redirect limit exceeded')
}

async function defaultUpload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(INBOUND_MMS_BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error('Inbound MMS storage upload failed')
}

export async function storeTwilioInboundMedia(input: {
  messageSid: string
  media: TwilioMediaRef[]
  priorMetadata?: Record<string, unknown> | null
  fetchImpl?: typeof fetch
  upload?: Upload
}): Promise<StoredInboundMms[]> {
  if (input.media.length === 0) return []
  const prior = storedFromMetadata(input.priorMetadata, input.media.length)
  if (prior) return prior
  if (!/^SM[0-9a-f]{32}$/i.test(input.messageSid)) throw new Error('Invalid MessageSid for media storage')
  const fetchImpl = input.fetchImpl ?? fetch
  const upload = input.upload ?? defaultUpload
  const stored: StoredInboundMms[] = []
  for (const item of input.media) {
    assertTwilioMediaUrl(item.url)
    const downloaded = await downloadTwilioMedia(item.url, fetchImpl)
    const contentType = storedContentType(downloaded.contentType, item.contentType)
    const storagePath = `${input.messageSid}/${mediaFilename(item.index, contentType)}`
    await upload(storagePath, downloaded.bytes, contentType)
    stored.push({
      index: item.index,
      storage_bucket: INBOUND_MMS_BUCKET,
      storage_path: storagePath,
      content_type: contentType,
      byte_size: downloaded.bytes.byteLength,
    })
  }
  return stored
}

export async function captureInboundMms(input: {
  form: FormData
  messageSid: string
  priorMetadata?: Record<string, unknown> | null
  fetchImpl?: typeof fetch
  upload?: Upload
}): Promise<CapturedInboundMms> {
  const media = readTwilioInboundMedia(input.form)
  const mms = await storeTwilioInboundMedia({
    messageSid: input.messageSid,
    media,
    priorMetadata: input.priorMetadata,
    fetchImpl: input.fetchImpl,
    upload: input.upload,
  })
  const rawBody = input.form.get('Body')
  const body = typeof rawBody === 'string' ? rawBody : ''
  return {
    description: inboundSmsDisplayBody(body, media.length),
    metadata: { num_media: media.length, mms },
  }
}
