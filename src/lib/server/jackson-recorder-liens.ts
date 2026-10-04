import { addIsoDays, chicagoDate } from '@/lib/prospecting/foreclosure'
import {
  JACKSON_RECORDER_ENTRY,
  JACKSON_RECORDER_HOME,
  JACKSON_RECORDER_PAGE_CAP,
  JACKSON_RECORDER_RESULTS,
  JACKSON_RECORDER_WINDOW_DAYS,
  jacksonRecorderBlock,
  jacksonRecorderPageEnd,
  jacksonRecorderSearchBody,
  parseJacksonRecorderLiens,
  readJacksonRecorderForm,
  type JacksonRecorderLien,
} from '@/lib/prospecting/jackson-recorder-liens'

const USER_AGENT = 'SavingKC-CRM-filing-probe/1.0 (Jackson County public records; commercial use authorized)'

export type JacksonRecorderFetch = {
  rows: JacksonRecorderLien[]
  reason: string | null
}

export async function fetchJacksonRecorderLiens(input?: {
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<JacksonRecorderFetch> {
  const fetchImpl = input?.fetchImpl ?? fetch
  const today = chicagoDate(input?.now ?? new Date())
  const fromIso = addIsoDays(today, 1 - JACKSON_RECORDER_WINDOW_DAYS)
  const jar = new Map<string, string>()
  try {
    await send(fetchImpl, jar, JACKSON_RECORDER_HOME)
    const rows: JacksonRecorderLien[] = []
    for (const docType of ['TL', 'LIEN'] as const) {
      const formPage = await send(fetchImpl, jar, JACKSON_RECORDER_ENTRY)
      const form = readJacksonRecorderForm(formPage.body)
      if ('blocked' in form) return { rows: dedupe(rows), reason: form.reason }
      if (!form.docTypeFields[docType]) continue
      const posted = await send(fetchImpl, jar, `${JACKSON_RECORDER_ENTRY}?e=newSession`, {
        method: 'POST',
        body: jacksonRecorderSearchBody(form, docType, fromIso, today),
        referer: JACKSON_RECORDER_ENTRY,
      })
      const block = jacksonRecorderBlock(posted.body)
      if (block) return { rows: dedupe(rows), reason: block }
      rows.push(...parseJacksonRecorderLiens(posted.body))
      let { end, total } = jacksonRecorderPageEnd(posted.body)
      for (let page = 2; page <= JACKSON_RECORDER_PAGE_CAP && end < total; page += 1) {
        const next = await send(fetchImpl, jar, `${JACKSON_RECORDER_RESULTS}?pg=${page}`)
        const nextBlock = jacksonRecorderBlock(next.body)
        if (nextBlock) return { rows: dedupe(rows), reason: nextBlock }
        rows.push(...parseJacksonRecorderLiens(next.body))
        const counts = jacksonRecorderPageEnd(next.body)
        if (counts.end <= end) break
        end = counts.end
        total = counts.total
      }
    }
    return { rows: dedupe(rows), reason: null }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : 'request failed'
    return { rows: [], reason: `Jackson recorder lien fetch failed closed (${message}).` }
  }
}

async function send(fetchImpl: typeof fetch, jar: Map<string, string>, url: string, init?: { method?: string; body?: string; referer?: string }): Promise<{ body: string }> {
  let current = url
  let method = init?.method ?? 'GET'
  let body = init?.body
  for (let hop = 0; hop < 5; hop += 1) {
    const headers = new Headers({
      Accept: 'text/html',
      'User-Agent': USER_AGENT,
    })
    if (jar.size > 0) headers.set('Cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '))
    if (method === 'POST') {
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
      headers.set('Referer', init?.referer ?? JACKSON_RECORDER_ENTRY)
    }
    const response = await fetchImpl(current, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    rememberCookies(jar, response)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) break
      current = new URL(location, current).toString()
      if (response.status === 303 || (response.status === 302 && method === 'POST')) {
        method = 'GET'
        body = undefined
      }
      continue
    }
    return { body: await response.text() }
  }
  throw new Error('Jackson recorder redirected too many times.')
}

function dedupe(rows: JacksonRecorderLien[]): JacksonRecorderLien[] {
  const unique = new Map<string, JacksonRecorderLien>()
  for (const row of rows) unique.set(row.id, row)
  return [...unique.values()]
}

function rememberCookies(jar: Map<string, string>, response: Response) {
  const lines = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''].filter(Boolean)
  for (const line of lines) {
    const pair = line.split(';')[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}
