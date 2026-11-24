/**
 * Recipient time gate for a callable number. The row stays in the export.
 * Earliest start is expressed in America/Chicago. Latest is 9pm in the
 * recipient's zone, and the campaign still ends at 5:00pm CT.
 */

export type CallTz = 'eastern' | 'central' | 'mountain' | 'pacific' | 'alaska' | 'hawaii' | 'unknown'

export const EARLIEST_CALL_CT: Record<CallTz, string> = {
  eastern: '09:00',
  central: '09:00',
  mountain: '10:00',
  pacific: '11:00',
  alaska: '12:00',
  hawaii: '13:00',
  unknown: '11:00',
}

export const CAMPAIGN_END_CT = '17:00'

const ZONE: Record<CallTz, string> = {
  eastern: 'America/New_York',
  central: 'America/Chicago',
  mountain: 'America/Denver',
  pacific: 'America/Los_Angeles',
  alaska: 'America/Anchorage',
  hawaii: 'Pacific/Honolulu',
  unknown: 'America/Los_Angeles',
}

const PHOENIX = new Set(['480', '520', '602', '623', '928'])

const AREA_TZ = buildAreaMap()

export interface CallSchedule {
  callTz: CallTz
  earliestCallCt: string
  iana: string
}

export function phoneCallSchedule(phone: string | null | undefined): CallSchedule {
  const area = areaCode(phone)
  const callTz = (area && AREA_TZ.get(area)) || 'unknown'
  const iana = area && PHOENIX.has(area) ? 'America/Phoenix' : ZONE[callTz]
  return { callTz, earliestCallCt: EARLIEST_CALL_CT[callTz], iana }
}

/** TCPA floor and ceiling: 8:00am inclusive through 9:00pm exclusive, recipient local. */
export function localTcpaWindowOpen(schedule: CallSchedule, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false
  const local = minutesInZone(now, schedule.iana)
  return local !== null && local >= 8 * 60 && local < 21 * 60
}

/** At or after earliest_call_ct and before 9:00pm in the recipient zone. */
export function recipientCallWindowOpen(schedule: CallSchedule, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false
  const central = minutesInZone(now, 'America/Chicago')
  if (central === null || central < clockMinutes(schedule.earliestCallCt)) return false
  const local = minutesInZone(now, schedule.iana)
  return local !== null && local < 21 * 60
}

/** Campaign calls still stop at 5:00pm CT. This does not remove the number. */
export function campaignEndOpen(now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false
  const central = minutesInZone(now, 'America/Chicago')
  return central !== null && central < clockMinutes(CAMPAIGN_END_CT)
}

function areaCode(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length < 10) return null
  return national.slice(-10, -7)
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function minutesInZone(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    let hour = Number(read('hour'))
    if (hour === 24) hour = 0
    return hour * 60 + Number(read('minute'))
  } catch {
    return null
  }
}

function buildAreaMap(): Map<string, CallTz> {
  const map = new Map<string, CallTz>()
  const add = (codes: string, tz: CallTz) => {
    for (const code of codes.split(',')) map.set(code, tz)
  }
  add('214,254,281,314,316,318,319,320,325,331,334,337,346,361,402,405,409,414,417,430,432,469,479,501,504,507,512,515,531,539,557,563,573,580,601,605,612,615,618,620,630,636,641,651,660,662,682,701,708,712,713,715,731,737,763,769,773,779,785,806,815,816,817,830,832,847,870,872,901,903,913,918,920,936,940,945,952,956,972,979,985', 'central')
  add('201,202,203,207,212,215,216,220,223,229,231,234,239,240,248,252,267,269,272,276,301,302,304,305,313,315,321,330,332,336,339,347,351,352,380,386,401,404,407,410,412,413,419,434,440,443,470,475,478,484,502,508,513,516,517,518,540,551,561,567,570,571,585,586,603,607,609,610,614,617,631,646,667,678,680,681,689,703,704,706,716,717,718,724,727,732,734,740,754,757,762,770,772,774,781,786,802,803,804,810,813,814,828,835,843,845,848,854,856,857,860,862,863,864,865,878,904,908,910,912,914,917,919,929,934,937,941,947,954,959,973,978,980,984', 'eastern')
  add('303,307,385,406,435,505,575,719,720,801,970,208,986', 'mountain')
  add('480,520,602,623,928', 'mountain')
  add('206,209,213,253,279,310,323,341,350,360,408,415,424,425,442,458,503,509,510,530,541,559,562,564,619,626,628,650,657,661,669,702,707,714,725,747,760,775,805,818,820,831,840,858,909,916,925,949,951,971', 'pacific')
  add('907', 'alaska')
  add('808', 'hawaii')
  return map
}
