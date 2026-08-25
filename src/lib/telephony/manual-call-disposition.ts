import type { DispositionType } from '@/lib/dialer-dispositions'

export async function saveManualCallDisposition(input: {
  phone: string
  disposition: DispositionType
  callerId: string | null
  durationSeconds: number
  clientAttemptId: string | null
  notes?: string
}): Promise<void> {
  const response = await fetch('/api/call-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: input.phone,
      event: 'dispositioned',
      status: 'completed',
      outcome: input.disposition,
      disposition: input.disposition,
      to_number: input.phone,
      from_number: input.callerId,
      duration_seconds: input.durationSeconds || null,
      clientAttemptId: input.clientAttemptId,
      notes: input.notes || null,
    }),
  })
  if (response.ok) return
  const payload = await response.json().catch(() => null)
  throw new Error(payload?.error || 'Could not save call outcome.')
}
