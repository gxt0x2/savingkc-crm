export const MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain',
])

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
}

export class MobileAttachmentError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}

export function safeMobileAttachmentFilename(value: string, mimeType: string): string {
  const basename = value.split(/[\\/]/).pop()?.normalize('NFKD') || ''
  const dot = basename.lastIndexOf('.')
  const sourceStem = dot > 0 ? basename.slice(0, dot) : basename
  const stem = sourceStem.replace(/[^\x00-\x7F]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'attachment'
  const suffix = `.${MIME_EXTENSION[mimeType]}`
  return `${stem.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`
}

export function validateMobileMessageFile(file: File) {
  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new MobileAttachmentError('Choose a supported image, audio recording, PDF, Word, Excel, or text file.', 415)
  }
  if (file.size < 1 || file.size > MOBILE_MESSAGE_ATTACHMENT_MAX_BYTES) {
    throw new MobileAttachmentError('Each attachment must be between 1 byte and 4 MB.', 413)
  }
  return { filename: safeMobileAttachmentFilename(file.name, mimeType), mimeType }
}
