import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeListLock, chicagoClock } from '@/lib/market-check/schedule'

export const MATRIX_PARTS = ['active', 'pending', 'sold', 'expired'] as const
export type MatrixPart = (typeof MATRIX_PARTS)[number]

const PART_ORDER: MatrixPart[] = ['expired', 'pending', 'sold', 'active']

/** File-name contract for one Heartland Matrix day folder. Active includes Coming Soon. */
export function matrixPartForFile(fileName: string): MatrixPart | null {
  const name = fileName.toLowerCase().replace(/[_-]+/g, ' ')
  for (const part of PART_ORDER) {
    if (part === 'active' && (name.includes('active') || name.includes('coming soon') || name.includes('comingsoon'))) return 'active'
    if (part !== 'active' && name.includes(part)) return part
  }
  return null
}

export function matrixSetComplete(parts: readonly string[]): boolean {
  return MATRIX_PARTS.every((part) => parts.includes(part))
}

export interface MatrixDayFiles {
  date: string
  directory: string
  parts: MatrixPart[]
  files: { name: string; part: MatrixPart; text: string }[]
  missing: MatrixPart[]
  partCounts: Record<MatrixPart, number>
  doneMarker: string | null
  complete: boolean
}

const DONE_MARKER_NAMES = ['done', 'DONE', '.done']

/** Data rows only. A header by itself is an empty part. */
export function csvDataRows(text: string): number {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 ? lines.length - 1 : 0
}

export function readDoneMarker(directory: string): string | null {
  for (const name of DONE_MARKER_NAMES) {
    const path = join(directory, name)
    if (!existsSync(path) || !statSync(path).isFile()) continue
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  }
  return null
}

export function readMatrixDay(directory: string, date: string, now: Date = new Date()): MatrixDayFiles {
  const names = readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.csv'))
  const files = names.flatMap((name) => {
    const part = matrixPartForFile(name)
    if (!part) return []
    return [{ name, part, text: readFileSync(join(directory, name), 'utf8') }]
  })
  const parts = [...new Set(files.map((file) => file.part))]
  const missing = MATRIX_PARTS.filter((part) => !parts.includes(part))
  const partCounts = {
    active: 0,
    pending: 0,
    sold: 0,
    expired: 0,
  } satisfies Record<MatrixPart, number>
  for (const file of files) partCounts[file.part] += csvDataRows(file.text)
  const doneMarker = readDoneMarker(directory)
  const today = chicagoClock(now).date
  return {
    date,
    directory,
    parts,
    files,
    missing,
    partCounts,
    doneMarker,
    complete: date === today
      && partCounts.expired > 0
      && partCounts.sold > 0
      && doneMarker === date
      && beforeListLock(now),
  }
}

/** Today's America/Chicago folder only. A newer or older folder does not count. */
export function loadTodayMatrixDay(root: string, now: Date = new Date()): MatrixDayFiles | null {
  if (!existsSync(root) || !statSync(root).isDirectory()) return null
  const date = chicagoClock(now).date
  const directory = join(root, date)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return null
  return readMatrixDay(directory, date, now)
}
