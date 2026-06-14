type ExportFailureAlertInput = {
  workflow?: unknown
  runId?: unknown
  runUrl?: unknown
  reason?: unknown
  response?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseResponse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function summarizeResult(response: unknown): string {
  const parsed = parseResponse(response)
  const result = record(parsed)
  if (Object.keys(result).length === 0) {
    const raw = text(parsed)
    return raw ? raw.slice(0, 320) : 'No exporter response was captured.'
  }

  const stats = [
    ['ok', result.ok],
    ['configured', result.configured],
    ['scanned', integer(result.scanned)],
    ['claimed', integer(result.claimed)],
    ['sent', integer(result.sent)],
    ['skipped', integer(result.skipped)],
    ['failed', integer(result.failed)],
    ['pending', integer(result.pending)],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')

  const missingConfig = array(result.missingConfig).map(text).filter(Boolean)
  const failedRows = array(result.results)
    .map(record)
    .filter((row) => text(row.status) === 'failed')
    .slice(0, 3)
    .map((row) => {
      const destinations = array(row.destinations)
        .map(record)
        .filter((destination) => text(destination.status) === 'failed')
        .map((destination) => {
          const detail = text(destination.detail)
          return `${text(destination.destination) || 'destination'}${detail ? `: ${detail}` : ''}`
        })
        .filter(Boolean)
        .join('; ')
      return `${text(row.eventName) || 'conversion'} ${text(row.id) || ''}${destinations ? ` - ${destinations}` : ''}`.trim()
    })

  return [
    stats || 'Exporter returned JSON without summary stats.',
    missingConfig.length ? `missingConfig=${missingConfig.join(', ')}` : '',
    ...failedRows,
  ].filter(Boolean).join('\n').slice(0, 900)
}

export function cleanAlertPhone(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.replace(/\s+/g, '')
}

export function buildPpcExportFailureAlertMessage(input: ExportFailureAlertInput): string {
  const workflow = text(input.workflow) || 'PPC conversion export'
  const reason = text(input.reason)
  const runId = text(input.runId)
  const runUrl = text(input.runUrl)
  const responseSummary = summarizeResult(input.response)

  return [
    `${workflow} failed.`,
    reason ? `Reason: ${reason}` : '',
    responseSummary,
    runUrl ? `Run: ${runUrl}` : runId ? `Run ID: ${runId}` : '',
  ].filter(Boolean).join('\n').slice(0, 1400)
}
