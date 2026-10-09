/** Public Jackson County recorder search. Commercial use of this county site is authorized. No dialer enrollment. */

export const JACKSON_RECORDER_HOME = 'https://aumentumweb.jacksongov.org/'
export const JACKSON_RECORDER_ENTRY = 'https://aumentumweb.jacksongov.org/RealEstate/SearchEntry.aspx'
export const JACKSON_RECORDER_RESULTS = 'https://aumentumweb.jacksongov.org/RealEstate/SearchResults.aspx'
export const JACKSON_RECORDER_WINDOW_DAYS = 14
export const JACKSON_RECORDER_PAGE_CAP = 5

export type JacksonLienKind = 'federal_tax_lien' | 'hoa_lien'

export type JacksonRecorderLien = {
  id: string
  county: 'jackson'
  state: 'MO'
  lien_kind: JacksonLienKind
  debtor_name: string
  instrument_number: string
  recorded_on: string | null
  source_name: 'Jackson County Recorder of Deeds'
  source_url: string
  dialer_enrolled: false
}

export type JacksonRecorderForm = {
  viewState: string
  viewStateGenerator: string
  eventValidation: string
  docTypeFields: Partial<Record<'TL' | 'LIEN', string>>
}

const HOA_PARTY = /\bHOA\b|HOMEOWNERS?|HOME\s*OWNERS?|HOMES\s+ASSOCIATION|CONDOMINIUM\s+ASSOCIATION|PROPERTY\s+OWNERS/i
const GOVERNMENT_PARTY = /\bUSA\b|U\.S\.A\.|UNITED STATES|INTERNAL REVENUE|TREASURY/i

export function jacksonRecorderDateState(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const token = `${year}-${month}-${day}-0-0-0-0`
  return `|0|01${token}||[[[[]],[],[]],[{},[]],"01${token}"]`
}

export function readJacksonRecorderForm(html: string): JacksonRecorderForm | { blocked: true; reason: string } {
  const block = jacksonRecorderBlock(html)
  if (block) return { blocked: true, reason: block }
  const viewState = inputValue(html, '__VIEWSTATE')
  const viewStateGenerator = inputValue(html, '__VIEWSTATEGENERATOR')
  const eventValidation = inputValue(html, '__EVENTVALIDATION')
  if (!viewState || !eventValidation) {
    return { blocked: true, reason: 'Jackson recorder search form did not include the public postback fields, so no lien rows were stored.' }
  }
  return {
    viewState,
    viewStateGenerator,
    eventValidation,
    docTypeFields: {
      TL: checkboxName(html, 'TL') ?? undefined,
      LIEN: checkboxName(html, 'LIEN') ?? undefined,
    },
  }
}

export function jacksonRecorderSearchBody(form: JacksonRecorderForm, docType: 'TL' | 'LIEN', fromIso: string, toIso: string): string {
  const field = form.docTypeFields[docType]
  if (!field) throw new Error(`Jackson recorder form has no ${docType} document type.`)
  const empty = '|0|01||[[[[]],[],[]],[{},[]],"01"]'
  const zero = '|0|00||[[[[]],[],[]],[{},[]],"00"]'
  const params = new URLSearchParams()
  params.set('__EVENTTARGET', 'ctl00$cphNoMargin$SearchButtons1$btnSearch')
  params.set('__EVENTARGUMENT', '0')
  params.set('__VIEWSTATE', form.viewState)
  params.set('__VIEWSTATEGENERATOR', form.viewStateGenerator)
  params.set('__EVENTVALIDATION', form.eventValidation)
  params.set('ctl00$cphNoMargin$f$NameSearchMode', 'rdoCombine')
  params.set('cphNoMargin_f_txtParty_clientState', empty)
  params.set('cphNoMargin_f_txtParty', 'Lastname Firstname')
  params.set('ctl00$cphNoMargin$f$drbPartyType', '')
  params.set('cphNoMargin_f_txtGrantor_clientState', zero)
  params.set('cphNoMargin_f_txtGrantee_clientState', zero)
  params.set('cphNoMargin_f_ddcDateFiledFrom_clientState', jacksonRecorderDateState(fromIso))
  params.set('cphNoMargin_f_ddcDateFiledTo_clientState', jacksonRecorderDateState(toIso))
  params.set(field, docType)
  params.set('LoginForm1_txtLogonName_clientState', empty)
  params.set('LoginForm1_txtPassword_clientState', empty)
  params.set('ctl00$LoginForm1$logonType', 'rdoPubCpu')
  params.set('ctl00$cphNoMargin$SearchButtons1$btnSearch__10', ':0')
  return params.toString()
}

export function jacksonRecorderBlock(html: string): string | null {
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  if (/browser test/i.test(title)) {
    return 'Jackson recorder returned Browser Test - Jackson County Public Access Search and did not open the public real estate index.'
  }
  if (/LoginForm1_RequiredFieldValidator/i.test(html) && /Required!/i.test(html) && !/Search Real Estate Index - Jackson County/i.test(title)) {
    return 'Jackson recorder search required LoginForm1 Logon Name and Password and returned no lien rows.'
  }
  return null
}

export function jacksonRecorderPageEnd(html: string): { end: number; total: number } {
  const end = Number(spanNumber(html, 'EndRow') ?? 0)
  const total = Number(spanNumber(html, 'TotalRows') ?? end)
  return { end, total }
}

export function parseJacksonRecorderLiens(html: string): JacksonRecorderLien[] {
  const rows: JacksonRecorderLien[] = []
  const seen = new Set<string>()
  for (const chunk of html.split(/id="[^"]*_Label1"/).slice(1)) {
    const instrument = chunk.match(/^[^>]*>([^<]+)/)?.[1]?.trim() ?? ''
    if (!/^20\d{2}E\d+$/i.test(instrument)) continue
    const recorded = chunk.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? ''
    const docType = chunk.match(/>(FEDERAL TAX LIEN|LIEN)</)?.[1] ?? ''
    const grantor = textAfter(chunk, 'lblTor')
    const grantee = textAfter(chunk, 'lblTee')
    const lien = classifyLien(docType, grantor, grantee, instrument, recorded)
    if (!lien || seen.has(lien.id)) continue
    seen.add(lien.id)
    rows.push(lien)
  }
  return rows
}

function classifyLien(docType: string, grantor: string, grantee: string, instrument: string, recorded: string): JacksonRecorderLien | null {
  if (docType === 'FEDERAL TAX LIEN') {
    const debtor = partyName(grantor, grantee, (name) => !GOVERNMENT_PARTY.test(name))
    if (!debtor) return null
    return row('federal_tax_lien', debtor, instrument, recorded)
  }
  if (docType === 'LIEN' && (HOA_PARTY.test(grantor) || HOA_PARTY.test(grantee))) {
    const debtor = partyName(grantor, grantee, (name) => !HOA_PARTY.test(name))
    if (!debtor) return null
    return row('hoa_lien', debtor, instrument, recorded)
  }
  return null
}

function partyName(grantor: string, grantee: string, keep: (name: string) => boolean): string | null {
  if (grantor && keep(grantor)) return grantor
  if (grantee && keep(grantee)) return grantee
  return grantor || grantee || null
}

function row(kind: JacksonLienKind, debtor: string, instrument: string, recorded: string): JacksonRecorderLien {
  const match = recorded.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return {
    id: `jackson-recorder:${kind}:${instrument}`,
    county: 'jackson',
    state: 'MO',
    lien_kind: kind,
    debtor_name: debtor,
    instrument_number: instrument,
    recorded_on: match ? `${match[3]}-${match[1]}-${match[2]}` : null,
    source_name: 'Jackson County Recorder of Deeds',
    source_url: JACKSON_RECORDER_ENTRY,
    dialer_enrolled: false,
  }
}

function inputValue(html: string, name: string): string {
  const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'i'))?.[0] ?? ''
  const value = tag.match(/value="([^"]*)"/i)?.[1] ?? ''
  return decode(value)
}

function checkboxName(html: string, value: string): string | null {
  return html.match(new RegExp(`name="([^"]+)"[^>]*value="${value}"`, 'i'))?.[1] ?? null
}

function spanNumber(html: string, idSuffix: string): string | null {
  return html.match(new RegExp(`id="[^"]*${idSuffix}"[^>]*>\\s*(\\d+)`, 'i'))?.[1] ?? null
}

function textAfter(chunk: string, idSuffix: string): string {
  return chunk.match(new RegExp(`${idSuffix}"[^>]*>\\s*([^<]+)`))?.[1]?.trim() ?? ''
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
