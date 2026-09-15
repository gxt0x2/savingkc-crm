export async function readCallReviewResponse<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const text = await response.text()
  if (!text) return { error: fallback } as T
  try {
    return JSON.parse(text) as T
  } catch {
    return { error: text.slice(0, 180) || fallback } as T
  }
}

export async function uploadCallReviewVoiceover(activityId: string, blob: Blob) {
  const file = new File([blob], `coaching-voiceover.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type })
  const response = await fetch('/api/marketing/call-review-voiceover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityId, mimeType: file.type, byteSize: file.size }),
  })
  const prepared = await readCallReviewResponse<{ error?: string; path?: string; mimeType?: string; token?: string; bucket?: string }>(response, 'Coaching voiceover upload could not be prepared.')
  if (!response.ok || !prepared.path || !prepared.token) throw new Error(prepared.error || 'Coaching voiceover could not be prepared.')
  const { createClient } = await import('@/lib/supabase/client')
  const { error } = await createClient().storage.from(prepared.bucket || 'documents').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(`Coaching voiceover could not be uploaded: ${error.message}`)
  return { path: prepared.path, mimeType: prepared.mimeType || blob.type }
}

export function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Review recording could not be preserved.'))
    reader.readAsDataURL(blob)
  })
}
