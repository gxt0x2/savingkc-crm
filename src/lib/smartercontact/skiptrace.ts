/**
 * Skip-trace provider abstraction.
 *
 * Skip tracing takes a list of property/owner records (name + address) and
 * appends contact data (phone, email) by matching against a third-party data
 * provider (e.g. BatchData, Skip Genie, PropStream, IDI, etc.).
 *
 * This deployment ships WITHOUT a bundled provider. Rather than hard-code one
 * vendor's request shape, we expose a single seam: set two env vars and any
 * HTTP JSON provider can be wired in.
 *
 *   SKIPTRACE_API_URL   — POST endpoint that accepts { rows } and returns
 *                         { results: [{ phone?, email?, ...original }] }
 *   SKIPTRACE_API_KEY   — sent as `Authorization: Bearer <key>`
 *
 * When those are absent, `runSkiptrace` is a no-op that returns the rows
 * unchanged, `matched: 0`, and an honest note explaining why. Nothing here ever
 * throws for a "missing provider" reason — callers can always persist a result.
 */

/** A single input/output row. Arbitrary CSV columns are preserved verbatim. */
export type SkiptraceRow = Record<string, string> & {
  phone?: string
  email?: string
}

export interface SkiptraceResult {
  /** Rows with phone/email appended where the provider found a match. */
  rows: SkiptraceRow[]
  /** How many rows the provider returned a phone OR email for. */
  matched: number
  /** True when a real provider ran; false when we passed rows through untouched. */
  providerRan: boolean
  /** Human-readable explanation surfaced in the UI (e.g. "no provider configured"). */
  note: string
}

/** Whether a skip-trace provider is configured via env. */
export function skiptraceProviderConfigured(): boolean {
  return Boolean(process.env.SKIPTRACE_API_URL && process.env.SKIPTRACE_API_KEY)
}

function countMatched(rows: SkiptraceRow[]): number {
  return rows.filter((r) => (r.phone && r.phone.trim()) || (r.email && r.email.trim())).length
}

/**
 * Append phone/email to `rows` using the configured provider, if any.
 *
 * Best-effort and total: on any error (network, bad response, timeout) this
 * returns the original rows with a `providerRan: false` note rather than
 * throwing, so the calling job can still complete and store what it has.
 */
export async function runSkiptrace(rows: SkiptraceRow[]): Promise<SkiptraceResult> {
  const url = process.env.SKIPTRACE_API_URL
  const key = process.env.SKIPTRACE_API_KEY

  if (!url || !key) {
    return {
      rows,
      matched: 0,
      providerRan: false,
      note: 'No skip-trace provider configured. Set SKIPTRACE_API_URL and SKIPTRACE_API_KEY to enable phone/email append. Rows were stored unchanged.',
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ rows }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        rows,
        matched: 0,
        providerRan: false,
        note: `Skip-trace provider returned HTTP ${res.status}. Rows were stored unchanged.${text ? ` (${text.slice(0, 200)})` : ''}`,
      }
    }

    const json = (await res.json().catch(() => null)) as
      | { results?: SkiptraceRow[]; rows?: SkiptraceRow[] }
      | null
    // Accept either { results } or { rows } for provider flexibility.
    const returned = json?.results ?? json?.rows
    if (!Array.isArray(returned)) {
      return {
        rows,
        matched: 0,
        providerRan: false,
        note: 'Skip-trace provider response missing a results array. Rows were stored unchanged.',
      }
    }

    // Merge provider output over the original rows positionally, so extra
    // provider fields (phone/email) are added without dropping input columns.
    const merged: SkiptraceRow[] = rows.map((orig, i) => ({ ...orig, ...(returned[i] || {}) }))
    const matched = countMatched(merged)
    return {
      rows: merged,
      matched,
      providerRan: true,
      note: `Skip-trace complete: ${matched} of ${rows.length} rows matched.`,
    }
  } catch (err) {
    return {
      rows,
      matched: 0,
      providerRan: false,
      note: `Skip-trace provider request failed: ${err instanceof Error ? err.message : String(err)}. Rows were stored unchanged.`,
    }
  }
}
