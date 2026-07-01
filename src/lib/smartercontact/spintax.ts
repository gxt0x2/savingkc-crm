/**
 * Spintax + merge-field rendering for SmarterContact campaigns.
 *
 * Two independent brace syntaxes coexist:
 *   - Spintax:      {option a|option b|option c}   (contains a `|`)
 *   - Merge field:  {first_name}                   (no `|`)
 *
 * We disambiguate by the presence of `|`. Spintax is resolved first
 * (innermost-first, so nesting like {Hi|{Hey|Yo}} works), then merge
 * fields are substituted.
 *
 * Variant selection is deterministic per-recipient: seeded by the
 * recipient key (phone) so the same person always receives the same
 * wording and tests are stable. Deliverability still benefits because
 * different recipients get different variants.
 */

/** Deterministic 32-bit hash of a string → uint32. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 seeded PRNG → () => float in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Split top-level `|` options within a spintax group body (ignores nested braces). */
function splitOptions(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (ch === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

/**
 * Resolve spintax groups. `rng` picks an option per group; innermost groups
 * are resolved first so nesting works.
 */
export function resolveSpintax(text: string, rng: () => number = Math.random): string {
  let out = text
  // Repeatedly resolve the innermost group that contains a pipe.
  // An innermost group has no `{` between its `{` and matching `}`.
  const innermost = /\{([^{}]*)\}/g
  let guard = 0
  while (guard++ < 10000) {
    let replaced = false
    out = out.replace(innermost, (whole, body: string) => {
      if (!body.includes('|')) return whole // merge field or literal — leave it
      replaced = true
      const opts = splitOptions(body)
      return opts[Math.floor(rng() * opts.length)] ?? ''
    })
    if (!replaced) break
  }
  return out
}

export type MergeContext = Record<string, unknown> & {
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  custom_fields?: Record<string, unknown> | null
}

/** Normalize a merge key: lowercase, strip spaces/underscores → canonical. */
function normKey(k: string): string {
  return k.toLowerCase().replace(/[\s_]+/g, '')
}

/**
 * Substitute merge fields like {first_name}, {firstName}, {First Name}.
 * Unknown fields resolve to '' (blank) to avoid leaking raw tags to prospects.
 * `custom_fields` keys are matched too.
 */
export function resolveMergeFields(text: string, ctx: MergeContext): string {
  // Build a normalized lookup of standard fields + custom fields.
  const lookup: Record<string, string> = {}
  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined) return
    lookup[normKey(k)] = String(v)
  }
  put('first_name', ctx.first_name)
  put('firstname', ctx.first_name)
  put('last_name', ctx.last_name)
  put('lastname', ctx.last_name)
  put('full_name', [ctx.first_name, ctx.last_name].filter(Boolean).join(' ') || null)
  put('name', [ctx.first_name, ctx.last_name].filter(Boolean).join(' ') || null)
  put('phone', ctx.phone)
  put('email', ctx.email)
  put('address', ctx.address)
  put('property_address', ctx.address)
  put('city', ctx.city)
  put('state', ctx.state)
  put('zip', ctx.zip)
  if (ctx.custom_fields && typeof ctx.custom_fields === 'object') {
    for (const [k, v] of Object.entries(ctx.custom_fields)) put(k, v)
  }

  return text.replace(/\{([^{}|]+)\}/g, (_whole, key: string) => {
    const val = lookup[normKey(key)]
    return val ?? ''
  })
}

/**
 * Full render: resolve spintax (seeded by recipient) then merge fields.
 * `seedKey` should uniquely identify the recipient (e.g. their phone).
 */
export function renderMessage(template: string, ctx: MergeContext, seedKey?: string): string {
  const seed = hashStr(seedKey || ctx.phone || String(Math.random()))
  const rng = mulberry32(seed)
  const spun = resolveSpintax(template, rng)
  return resolveMergeFields(spun, ctx).trim()
}

/**
 * Count how many distinct spintax variants a template can produce.
 * Concatenated segments multiply; a group's options sum (recursively),
 * so nesting is counted correctly. Merge-field braces (no `|`) count as 1.
 * Capped to a safe integer. Useful for a builder "N variants" indicator.
 */
export function countVariants(template: string): number {
  // Parse a run of text at the given position until an unmatched `}` (depth<0)
  // or end of string, returning [variantCount, nextIndex].
  function parseSeq(str: string, start: number): [number, number] {
    let product = 1
    let i = start
    while (i < str.length) {
      const ch = str[i]
      if (ch === '}' || ch === '|') break // end of enclosing group / option
      if (ch === '{') {
        const [groupCount, next] = parseGroup(str, i)
        product = Math.min(product * groupCount, Number.MAX_SAFE_INTEGER)
        i = next
      } else {
        i++ // literal char contributes factor 1
      }
    }
    return [product, i]
  }

  // Parse a `{...}` starting at str[i]==='{'. Returns [variantCount, indexAfter'}'].
  function parseGroup(str: string, i: number): [number, number] {
    let j = i + 1
    let sum = 0
    let optionCount = 0
    let hasPipe = false
    // Walk options separated by top-level `|`.
    for (;;) {
      const [optCount, next] = parseSeq(str, j)
      sum += optCount
      optionCount++
      j = next
      if (str[j] === '|') {
        hasPipe = true
        j++ // skip pipe, parse next option
        continue
      }
      break
    }
    // Consume the closing brace if present.
    if (str[j] === '}') j++
    // No pipe → it's a merge field / literal brace group → 1 variant.
    if (!hasPipe) return [1, j]
    return [Math.min(sum, Number.MAX_SAFE_INTEGER), j]
    void optionCount
  }

  const [count] = parseSeq(template, 0)
  return count
}
