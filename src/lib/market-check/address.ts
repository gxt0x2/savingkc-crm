/**
 * Street matching mirrors compiler/mls.py in savingkc-inherited-lists:
 * number + street words + unit, suffix and direction abbreviations, zip5.
 */

const WORDS: Record<string, string> = {
  STREET: 'ST',
  AVENUE: 'AVE',
  TERRACE: 'TER',
  ROAD: 'RD',
  DRIVE: 'DR',
  BOULEVARD: 'BLVD',
  LANE: 'LN',
  PLACE: 'PL',
  COURT: 'CT',
  CIRCLE: 'CIR',
  PARKWAY: 'PKWY',
  HIGHWAY: 'HWY',
  EXTENSION: 'EXT',
  TRAIL: 'TRL',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
}

const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])
const SUFFIXES = new Set(
  [...Object.values(WORDS)].filter((word) => !DIRECTIONS.has(word)).concat(['WAY', 'TRL', 'TRAIL', 'RIDGE']),
)
const UNIT = /(?:#|\bUNIT\b\s*#?|\bAPT\b\.?\s*#?|\bSTE\b\.?\s*#?|\bSUITE\b\s*#?)\s*([A-Z0-9-]+)/i

export interface AddressParts {
  number: string
  street: string[]
  unit: string
}

export function addressParts(text: string | null | undefined): AddressParts {
  const streetLine = (text ?? '').toUpperCase().split(',')[0] ?? ''
  const found = UNIT.exec(streetLine)
  const unit = found ? found[1].replace(/^0+/, '') : ''
  const stripped = streetLine.replace(UNIT, ' ')
  const words = stripped
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => WORDS[word] ?? word.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'))
  if (!words.length || !/\d/.test(words[0][0] ?? '')) return { number: '', street: [], unit: '' }
  return { number: words[0], street: words.slice(1), unit }
}

export function normalizeMarketAddress(text: string | null | undefined): string {
  const { number, street, unit } = addressParts(text)
  if (!number) return ''
  return [number, ...street, ...(unit ? ['UNIT', unit] : [])].join(' ')
}

export function coreMarketAddress(text: string | null | undefined): string {
  const { number, street, unit } = addressParts(text)
  if (!number) return ''
  const core = street.filter((word) => !SUFFIXES.has(word) && !DIRECTIONS.has(word))
  return [number, ...core, ...(unit ? ['UNIT', unit] : [])].join(' ')
}

export function zip5(text: string | null | undefined): string {
  const found = String(text ?? '').match(/\d{5}/)
  return found ? found[0] : ''
}

export function normalizeParcelId(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function normalizeOwnerName(value: string | null | undefined): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when both names are present and differ after token-sorted normalization. */
export function ownersChanged(rollOwner: string | null | undefined, prospectOwner: string | null | undefined): boolean {
  const left = normalizeOwnerName(rollOwner).split(' ').filter(Boolean).sort().join(' ')
  const right = normalizeOwnerName(prospectOwner).split(' ').filter(Boolean).sort().join(' ')
  if (!left || !right) return false
  return left !== right
}
