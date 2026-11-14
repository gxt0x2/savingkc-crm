/** Service-county target zips and per-zip list-price floors. The loader reads the tables, not these constants. Cass is not a service county. */

export type TargetZipStatus = 'core' | 'keep' | 'parked' | 'avoid'

export type ServiceCounty = 'jackson' | 'clay' | 'platte' | 'johnson' | 'wyandotte'

export interface TargetZipSeed {
  zip5: string
  county: ServiceCounty
  state: 'MO' | 'KS'
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

function zips(list: string[], status: TargetZipStatus, county: ServiceCounty = 'jackson', state: 'MO' | 'KS' = 'MO'): TargetZipSeed[] {
  return list.map((zip5) => ({ zip5, county, state, status }))
}

const CLAY = ['64060', '64068', '64116', '64117', '64118', '64119', '64155', '64156', '64157', '64158', '64165', '64166', '64167']
const PLATTE = ['64079', '64098', '64151', '64152', '64153', '64154', '64163', '64164']
const WYANDOTTE = ['66101', '66102', '66103', '66104', '66105', '66106', '66109', '66111', '66112']
const JOHNSON = [
  '66202', '66203', '66204', '66205', '66206', '66207', '66208', '66209', '66210',
  '66212', '66213', '66214', '66215', '66216', '66217', '66218', '66219', '66220',
  '66221', '66223', '66224', '66226',
]

export const TARGET_ZIPS: TargetZipSeed[] = [
  ...zips(CORE, 'core'),
  ...zips(KEEP, 'keep'),
  ...zips(PARKED, 'parked'),
  ...zips(AVOID, 'avoid'),
  ...zips(CLAY, 'keep', 'clay', 'MO'),
  ...zips(PLATTE, 'keep', 'platte', 'MO'),
  ...zips(WYANDOTTE, 'keep', 'wyandotte', 'KS'),
  ...zips(JOHNSON, 'keep', 'johnson', 'KS'),
]

export const SERVICE_COUNTIES: ServiceCounty[] = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte']

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
