import { addIsoDays, chicagoDate } from '@/lib/prospecting/foreclosure'
import {
  type IntakeReviewStatus,
  extractZip,
  foreclosureIntakeOutreachBlockers,
  normalizeParcelId,
  normalizePartyName,
  splitPropertyAddress,
  unitsAgree,
} from '@/lib/prospecting/foreclosure-intake'

export const CALLING_LIST_LOCK_MINUTES = 4 * 60

export function chicagoClock(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '0'
  let hour = Number(value('hour'))
  if (hour === 24) hour = 0
  return { date: `${value('year')}-${value('month')}-${value('day')}`, minutes: hour * 60 + Number(value('minute')) }
}

/** The 4:00am CT lock closes that day's calling list. A later approval waits for the next day. */
export function callingListExportDay(approvedAt: Date): string {
  const clock = chicagoClock(approvedAt)
  if (clock.minutes >= CALLING_LIST_LOCK_MINUTES) return addIsoDays(clock.date, 1)
  return clock.date
}

export function joinsCallingListOn(approvedAt: Date, listDay: string): boolean {
  return callingListExportDay(approvedAt) <= listDay
}

/**
 * 7:55am CT pre-export filter hook.
 * Call this before a foreclosure row is written into that day's calling export.
 * It does not call a vendor. Rows approved at or after the 4:00am CT lock stay off that day's file.
 */
export function preExportFilter<T extends {
  reviewStatus: IntakeReviewStatus
  approvedAt: string | null
  state: string | null
  county: string | null
  dnc: boolean
  optedOut: boolean
  ksLicenseConfirmed: boolean | null
}>(rows: readonly T[], now: Date): T[] {
  const listDay = chicagoDate(now)
  return rows.filter((row) => {
    if (foreclosureIntakeOutreachBlockers(row).length > 0) return false
    if (!row.approvedAt) return false
    return joinsCallingListOn(new Date(row.approvedAt), listDay)
  })
}

export function liveFilingSalePatch(
  existing: {
    ownerName: string | null
    situs: string | null
    parcelId: string | null
    zip: string | null
    saleDate: string | null
    saleStatus: string | null
  },
  incoming: {
    ownerName: string | null
    propertyAddress: string | null
    parcelId: string | null
    zip: string | null
    saleDate: string | null
    saleStatus: string | null
  },
): { ok: false; code: 'identity_conflict' } | { ok: true; patch: { sale_date?: string; sale_status?: string } } {
  const existingParcel = normalizeParcelId(existing.parcelId)
  const incomingParcel = normalizeParcelId(incoming.parcelId)
  const existingAddress = splitPropertyAddress(existing.situs)
  const incomingAddress = splitPropertyAddress(incoming.propertyAddress)
  const existingZip = existing.zip ?? extractZip(existing.situs)
  const incomingZip = incoming.zip ?? extractZip(incoming.propertyAddress)
  const parcelConflict = Boolean(existingParcel && incomingParcel && existingParcel !== incomingParcel)
  const unitConflict = !unitsAgree(existingAddress.unit, incomingAddress.unit)
  const streetConflict = Boolean(
    existingAddress.street && incomingAddress.street && existingZip && incomingZip
    && (existingAddress.street !== incomingAddress.street || existingZip !== incomingZip)
  )
  const existingOwner = normalizePartyName(existing.ownerName)
  const incomingOwner = normalizePartyName(incoming.ownerName)
  const ownerConflict = Boolean(existingOwner && incomingOwner && existingOwner !== incomingOwner)
  if (parcelConflict || unitConflict || streetConflict || ownerConflict) return { ok: false, code: 'identity_conflict' }
  const patch: { sale_date?: string; sale_status?: string } = {}
  if (incoming.saleDate && incoming.saleDate !== existing.saleDate) patch.sale_date = incoming.saleDate
  if (incoming.saleStatus && incoming.saleStatus !== existing.saleStatus) patch.sale_status = incoming.saleStatus
  return { ok: true, patch }
}
