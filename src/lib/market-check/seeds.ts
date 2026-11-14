/** Jackson MO target zips and per-zip list-price floors. The loader reads the tables, not these constants. */

export type TargetZipStatus = 'core' | 'keep' | 'parked' | 'avoid'

export interface TargetZipSeed {
  zip5: string
  county: 'jackson'
  state: 'MO'
  status: TargetZipStatus
}

export interface PriceThresholdSeed {
  zip5: string
  minListPrice: number
  method: 'compiled' | 'trailing_12_month_override'
}

const CORE = ['64030', '64055', '64063', '64114', '64133', '64134', '64138']
const KEEP = [
  '64014', '64015', '64016', '64029', '64034', '64054', '64056', '64057', '64058',
  '64064', '64070', '64075', '64081', '64082', '64086',
  '64105', '64106', '64108', '64109', '64110', '64111', '64112', '64113',
  '64136', '64137', '64139', '64145', '64146',
]
const PARKED = ['64131']
const AVOID = ['64125', '64126', '64127', '64128', '64129', '64130']

function zips(list: string[], status: TargetZipStatus): TargetZipSeed[] {
  return list.map((zip5) => ({ zip5, county: 'jackson', state: 'MO', status }))
}

export const TARGET_ZIPS: TargetZipSeed[] = [
  ...zips(CORE, 'core'),
  ...zips(KEEP, 'keep'),
  ...zips(PARKED, 'parked'),
  ...zips(AVOID, 'avoid'),
]

const PRICES: Array<[string, number, PriceThresholdSeed['method']?]> = [
  ['64030', 265000], ['64055', 225000], ['64063', 340000], ['64114', 345000],
  ['64133', 235000], ['64134', 180000, 'trailing_12_month_override'], ['64138', 210000],
  ['64014', 320000], ['64015', 315000], ['64016', 240000], ['64029', 355000],
  ['64034', 390000], ['64054', 175000], ['64056', 250000], ['64057', 315000], ['64058', 260000],
  ['64064', 440000], ['64070', 425000], ['64075', 360000], ['64081', 435000],
  ['64082', 525000], ['64086', 385000],
  ['64105', 240000], ['64106', 170000], ['64108', 330000], ['64109', 270000],
  ['64110', 295000], ['64111', 320000], ['64112', 450000], ['64113', 610000],
  ['64136', 300000], ['64137', 230000], ['64139', 530000], ['64145', 430000], ['64146', 245000],
  ['64131', 230000],
  ['64125', 110000], ['64126', 95000], ['64127', 115000], ['64128', 115000],
  ['64129', 160000], ['64130', 105000],
]

export const PRICE_THRESHOLDS: PriceThresholdSeed[] = PRICES.map(([zip5, minListPrice, method]) => ({
  zip5,
  minListPrice,
  method: method ?? 'compiled',
}))

export function intakeStatuses(): TargetZipStatus[] {
  return ['core', 'keep']
}
