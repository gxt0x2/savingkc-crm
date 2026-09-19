import { DOCUMENTS_BUCKET } from '@/lib/documents'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024
export const MOBILE_MESSAGE_ATTACHMENT_MAX_COUNT = 4
export const MOBILE_MMS_MAX_BYTES = 5 * 1024 * 1024
export const MOBILE_MMS_OTHER_MEDIA_MAX_BYTES = 500 * 1024
export const MOBILE_MMS_FILENAME_MAX_LENGTH = 20

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
])

const MMS_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/heic',
  'image/heif',
  'audio/mp4',
  'audio/mpeg',
  'audio/webm',
])

const MMS_FULL_SIZE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
])

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
}

export type MobileMessageAttachment = {
  id: string
  filename: string
  mimeType: string
  byteSize: number
  storagePath: string
}

export class MobileAttachmentError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

export function safeMobileAttachmentFilename(value: string, mimeType: string): string {
  const basename = value.split(/[\\/]/).pop()?.normalize('NFKD') || ''
  const dot = basename.lastIndexOf('.')
  const sourceExtension = dot > 0 ? basename.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').toLowerCase() : ''
  const extension = MIME_EXTENSION[mimeType] || (sourceExtension && sourceExtension.length <= 5 ? sourceExtension : 'file')
  const sourceStem = dot > 0 ? basename.slice(0, dot) : basename
  const stem = sourceStem
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '') || 'attachment'
  const suffix = `.${extension}`
  return `${stem.slice(0, Math.max(1, MOBILE_MMS_FILENAME_MAX_LENGTH - suffix.length))}${suffix}`
}

export function validateMobileMessageFile(file: File) {
  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new MobileAttachmentError('Choose a JPEG, PNG, GIF, WebP, HEIC, or supported audio recording.', 415)
  }
  if (file.size < 1 || file.size > MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES) {
    throw new MobileAttachmentError('Each attachment must be between 1 byte and 4 MB.', 413)
  }
  const filename = safeMobileAttachmentFilename(file.name, mimeType)
  return { filename, mimeType }
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const character of value) {
    const point = character.codePointAt(0) || 0
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return bytes
}

export function validateMobileMmsAttachments(attachments: MobileMessageAttachment[], body: string) {
  let totalBytes = utf8ByteLength(body)
  for (const attachment of attachments) {
    if (!MMS_ALLOWED_MIME_TYPES.has(attachment.mimeType)) {
      throw new MobileAttachmentError(`${attachment.filename} cannot be sent by MMS. Send it by email or choose a supported image or recording.`, 415)
    }
    if (attachment.filename.length > MOBILE_MMS_FILENAME_MAX_LENGTH || !/^[A-Za-z0-9._-]+$/.test(attachment.filename)) {
      throw new MobileAttachmentError(`${attachment.filename} needs to be removed and added again before MMS delivery.`, 409)
    }
    if (!MMS_FULL_SIZE_MIME_TYPES.has(attachment.mimeType) && attachment.byteSize > MOBILE_MMS_OTHER_MEDIA_MAX_BYTES) {
      throw new MobileAttachmentError(`${attachment.filename} exceeds the 500 KB MMS limit for this media type.`, 413)
    }
    totalBytes += attachment.byteSize
  }
  if (totalBytes >= MOBILE_MMS_MAX_BYTES) {
    throw new MobileAttachmentError('The message and attachments must total less than 5 MB for MMS delivery.', 413)
  }
}

export async function readMobileMessageAttachments(leadId: string, values: unknown): Promise<MobileMessageAttachment[]> {
  if (values === undefined) return []
  if (!Array.isArray(values) || values.length > MOBILE_MESSAGE_ATTACHMENT_MAX_COUNT) {
    throw new MobileAttachmentError(`Choose no more than ${MOBILE_MESSAGE_ATTACHMENT_MAX_COUNT} attachments.`, 400)
  }
  const ids = [...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))]
  if (ids.length !== values.length) throw new MobileAttachmentError('Attachment ids must be unique and non-empty.', 400)
  if (ids.length === 0) return []
  const { data, error } = await supabaseAdmin().from('documents')
    .select('id,filename,mime_type,byte_size,storage_path')
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .eq('doc_type', 'message_attachment')
    .in('id', ids)
  if (error) throw new MobileAttachmentError('Attachments could not be verified.', 503)
  if (!data || data.length !== ids.length) throw new MobileAttachmentError('One or more attachments are unavailable for this lead.', 409)
  const byId = new Map(data.map((row) => [row.id, row]))
  return ids.map((id) => {
    const row = byId.get(id)!
    const mimeType = String(row.mime_type || '').toLowerCase()
    const byteSize = Number(row.byte_size || 0)
    if (!ALLOWED_MIME_TYPES.has(mimeType) || byteSize < 1 || byteSize > MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES) {
      throw new MobileAttachmentError('One or more attachments are not safe to send.', 409)
    }
    return {
      id,
      filename: String(row.filename),
      mimeType,
      byteSize,
      storagePath: String(row.storage_path),
    }
  })
}

export async function signedMobileAttachmentUrls(attachments: MobileMessageAttachment[]): Promise<string[]> {
  const db = supabaseAdmin()
  return Promise.all(attachments.map(async (attachment) => {
    const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUrl(attachment.storagePath, 60 * 60)
    if (error || !data?.signedUrl) throw new MobileAttachmentError('An attachment could not be prepared for MMS delivery.', 503)
    return data.signedUrl
  }))
}

export async function resendMobileAttachments(attachments: MobileMessageAttachment[]) {
  const db = supabaseAdmin()
  return Promise.all(attachments.map(async (attachment) => {
    const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).download(attachment.storagePath)
    if (error || !data) throw new MobileAttachmentError('An attachment could not be prepared for email delivery.', 503)
    return { filename: attachment.filename, content: Buffer.from(await data.arrayBuffer()) }
  }))
}

export function publicAttachmentMetadata(attachments: MobileMessageAttachment[]) {
  return attachments.map(({ id, filename, mimeType, byteSize }) => ({ id, filename, mimeType, byteSize }))
}
