import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Seed files are the list. Another county is another row in the CSV. */

export type TargetZipStatus = 'core' | 'keep' | 'parked' | 'avoid'

export interface TargetZipSeed {
  zip5: string
  county: string
  state: string
  status: TargetZipStatus
}

export interface PriceThresholdSeed {
  zip5: string
  minListPrice: number
  method: string
  confidence: string
}

export const TARGET_ZIPS_PATH = join(process.cwd(), 'data/mls-seeds/target_zips.csv')
export const PRICE_THRESHOLDS_PATH = join(process.cwd(), 'data/mls-seeds/min_list_price_by_zip.csv')

function table(text: string): Record<string, string>[] {
  const [header, ...lines] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const keys = (header ?? '').split(',').map((key) => key.trim())
  return lines.filter((line) => line.trim()).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()]))
  })
}

export function parseTargetZips(text: string): TargetZipSeed[] {
  return table(text).map((row) => ({
    zip5: row.zip5,
    county: row.county,
    state: row.state,
    status: row.status as TargetZipStatus,
  }))
}

export function parsePriceThresholds(text: string): PriceThresholdSeed[] {
  return table(text).map((row) => ({
    zip5: row.zip5,
    minListPrice: Number(row.min_list_price),
    method: row.method,
    confidence: row.confidence,
  }))
}

export function readTargetZips(text = readFileSync(TARGET_ZIPS_PATH, 'utf8')): TargetZipSeed[] {
  return parseTargetZips(text)
}

export function readPriceThresholds(text = readFileSync(PRICE_THRESHOLDS_PATH, 'utf8')): PriceThresholdSeed[] {
  return parsePriceThresholds(text)
}

export const TARGET_ZIPS = readTargetZips()
export const PRICE_THRESHOLDS = readPriceThresholds()

export function marketSeedPayload(zips = TARGET_ZIPS, prices = PRICE_THRESHOLDS) {
  return { zips, prices }
}

export function intakeStatuses(): TargetZipStatus[] {
  return ['core', 'keep']
}
