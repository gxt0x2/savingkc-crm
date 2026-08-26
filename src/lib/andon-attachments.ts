export const ANDON_ATTACHMENTS_BUCKET = 'andon-attachments'
export const MAX_ANDON_ATTACHMENTS = 8
export const MAX_ANDON_ATTACHMENT_BYTES = 50 * 1024 * 1024

export const ANDON_ATTACHMENT_ACCEPT = [
  'image/*',
  'video/*',
  'audio/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.rtf',
  '.zip',
].join(',')

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/rtf',
  'application/zip',
  'text/csv',
  'text/plain',
  'text/rtf',
])

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'rtf',
  'zip',
])

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  'aac',
  'avi',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'm4a',
  'm4v',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'ogg',
  'png',
  'wav',
  'webm',
  'webp',
])

export type AndonAttachmentKind = 'image' | 'video' | 'audio' | 'file'

export interface AndonAttachmentInput {
  name: string
  type: string
  size: number
}

export interface AndonAttachmentRow {
  id: string
  feedback_id: string
  filename: string
  mime_type: string | null
  byte_size: number
  kind: AndonAttachmentKind
  created_at: string
}

function extension(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

export function andonAttachmentKind(mimeType: string, filename = ''): AndonAttachmentKind {
  const normalized = mimeType.toLowerCase()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.startsWith('audio/')) return 'audio'

  const ext = extension(filename)
  if (['heic', 'heif', 'jpeg', 'jpg', 'png', 'webp'].includes(ext)) return 'image'
  if (['avi', 'm4v', 'mov', 'mp4', 'mpeg', 'webm'].includes(ext)) return 'video'
  if (['aac', 'm4a', 'mp3', 'ogg', 'wav'].includes(ext)) return 'audio'
  return 'file'
}

export function validateAndonAttachment(input: AndonAttachmentInput): string | null {
  if (!input.name.trim()) return 'The attachment needs a filename.'
  if (!Number.isFinite(input.size) || input.size <= 0) return `${input.name} is empty.`
  if (input.size > MAX_ANDON_ATTACHMENT_BYTES) return `${input.name} exceeds the 50 MB file limit.`

  const mimeType = input.type.toLowerCase()
  const ext = extension(input.name)
  const allowedMime = mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)
  const allowedExtension = ALLOWED_DOCUMENT_EXTENSIONS.has(ext) || ALLOWED_MEDIA_EXTENSIONS.has(ext)
  if (mimeType && mimeType !== 'application/octet-stream' && !allowedMime) {
    return `${input.name} is not a supported image, video, audio, or document file.`
  }
  if (!allowedMime && !allowedExtension) {
    return `${input.name} is not a supported image, video, audio, or document file.`
  }
  return null
}

export function safeAndonAttachmentName(filename: string) {
  const safe = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '')
    .slice(0, 120)
  return safe || 'attachment'
}

export function formatAndonAttachmentBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
