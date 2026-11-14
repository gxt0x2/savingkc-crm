import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeListLock } from '@/lib/market-check/schedule'

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

export interface MatrixDayFolder {
  date: string
  directory: string
}

/** Newest YYYY-MM-DD directory under the Matrix export root. */
export function newestMatrixDay(root: string, entries: readonly string[] = readdirSync(root)): MatrixDayFolder | null {
  const days = entries
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort()
  const date = days.at(-1)
  if (!date) return null
  return { date, directory: join(root, date) }
}

export interface MatrixDayFiles {
  date: string
  directory: string
  parts: MatrixPart[]
  files: { name: string; part: MatrixPart; text: string }[]
  missing: MatrixPart[]
  complete: boolean
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
  return {
    date,
    directory,
    parts,
    files,
    missing,
    complete: missing.length === 0 && beforeListLock(now),
  }
}

export function loadNewestMatrixDay(root: string, now: Date = new Date()): MatrixDayFiles | null {
  if (!existsSync(root) || !statSync(root).isDirectory()) return null
  const newest = newestMatrixDay(root)
  if (!newest) return null
  return readMatrixDay(newest.directory, newest.date, now)
}
