import { describe, expect, it } from 'vitest'
import { addIsoDays } from '@/lib/prospecting/foreclosure'
import {
  JACKSON_RECORDER_WINDOW_DAYS,
  jacksonRecorderBlock,
  jacksonRecorderDateState,
  jacksonRecorderSearchBody,
  parseJacksonRecorderLiens,
  readJacksonRecorderForm,
} from '@/lib/prospecting/jackson-recorder-liens'
import { fetchJacksonRecorderLiens } from '@/lib/server/jackson-recorder-liens'

const FORM = `
<title>Search Real Estate Index: Selection Criteria - Jackson County Public Access Search</title>
<input name="__VIEWSTATE" value="view&amp;state" />
<input name="__VIEWSTATEGENERATOR" value="88A9CE5A" />
<input name="__EVENTVALIDATION" value="event" />
<input name="ctl00$cphNoMargin$f$dclDocType$32" value="TL" />
<input name="ctl00$cphNoMargin$f$dclDocType$43" value="LIEN" />
<input id="LoginForm1_txtPassword" />
`

const RESULTS = `
<title>Search Real Estate Index - Jackson County Public Access Search</title>
<span id="cph_EndRow">2</span><span id="cph_TotalRows">2</span>
<span id="a_Label1"> 2026E0000001</span><td>10/01/2026</td><td>FEDERAL TAX LIEN</td>
<span id="a_lblTor">ADA OWNER</span><span id="a_lblTee">USA</span>
<span id="b_Label1"> 2026E0000002</span><td>09/30/2026</td>
<td>LIEN</td><span id="b_lblTor">BEN OWNER</span><span id="b_lblTee">OAK HOMEOWNERS ASSOCIATION</span>
<span id="c_Label1"> 2026E0000003</span><td>09/29/2026</td>
<td>LIEN</td><span id="c_lblTor">MECHANIC CO</span><span id="c_lblTee">PAT PAYEE</span>
`

describe('Jackson recorder lien parse', () => {
  it('keeps federal tax liens and HOA liens and drops other liens from the dialer', () => {
    const rows = parseJacksonRecorderLiens(RESULTS)
    expect(rows.map((row) => [row.lien_kind, row.debtor_name, row.dialer_enrolled])).toEqual([
      ['federal_tax_lien', 'ADA OWNER', false],
      ['hoa_lien', 'BEN OWNER', false],
    ])
    expect(rows[0].recorded_on).toBe('2026-10-01')
    expect(rows.every((row) => row.county === 'jackson' && row.state === 'MO')).toBe(true)
  })

  it('names the browser-test wall and still reads the public search form', () => {
    expect(jacksonRecorderBlock('<title>Browser Test - Jackson County Public Access Search</title>')).toMatch(/Browser Test/)
    const form = readJacksonRecorderForm(FORM)
    expect('blocked' in form).toBe(false)
    if ('blocked' in form) return
    const body = jacksonRecorderSearchBody(form, 'TL', '2026-09-20', '2026-10-03')
    expect(body).toContain('__EVENTTARGET=ctl00%24cphNoMargin%24SearchButtons1%24btnSearch')
    expect(body).toContain('2026-9-20-0-0-0-0')
    expect(jacksonRecorderDateState('2026-10-03')).toContain('2026-10-3-0-0-0-0')
    expect(form.viewState).toBe('view&state')
  })

  it('fetches both document types from fixture pages and stores no rows when the form is the browser test', async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (init?.method === 'POST') return new Response(RESULTS, { status: 200 })
      if (href.includes('SearchEntry')) return new Response(FORM, { status: 200 })
      return new Response('<title>Welcome - Jackson County Public Access Search</title>', { status: 200 })
    }) as unknown as typeof fetch
    const result = await fetchJacksonRecorderLiens({ now: new Date('2026-10-04T15:00:00Z'), fetchImpl })
    expect(result.reason).toBeNull()
    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((row) => row.dialer_enrolled === false)).toBe(true)
    expect(addIsoDays('2026-10-04', 1 - JACKSON_RECORDER_WINDOW_DAYS)).toBe('2026-09-21')

    const blocked = await fetchJacksonRecorderLiens({
      fetchImpl: (async () => new Response('<title>Browser Test - Jackson County Public Access Search</title>', { status: 200 })) as unknown as typeof fetch,
    })
    expect(blocked.rows).toEqual([])
    expect(blocked.reason).toMatch(/Browser Test/)
  })
})
