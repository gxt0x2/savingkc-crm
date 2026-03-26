export type Temperature = 'hot' | 'warm' | 'cool' | 'cold'

export interface TemperatureInput {
  priority: string | null
  station: string | null
  created_at: string
}

const STATION_SCORES: Record<string, number> = {
  contract_signed: 100,
  negotiations: 85,
  qualifying: 72,
  appt_set: 65,
  contacted: 50,
  not_contacted: 30,
  intake: 20,
  dead: 0,
}

const PRIORITY_BONUS: Record<string, number> = {
  hot: 30,
  high: 15,
  normal: 0,
}

function recencyBonus(createdAt: string): number {
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (days <= 7) return 15
  if (days <= 30) return 5
  if (days <= 90) return 0
  return -15
}

export function calculateTemperature(lead: TemperatureInput): Temperature {
  const stationScore = STATION_SCORES[lead.station || 'intake'] ?? 20
  const priorityBonus = PRIORITY_BONUS[lead.priority || 'normal'] ?? 0
  const bonus = recencyBonus(lead.created_at)

  const score = Math.min(100, Math.max(0, stationScore + priorityBonus + bonus))

  if (score >= 70) return 'hot'
  if (score >= 50) return 'warm'
  if (score >= 30) return 'cool'
  return 'cold'
}

export const TEMPERATURE_CONFIG = {
  hot:  { label: '🔥 Hot',  bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500' },
  warm: { label: '🌤 Warm', bg: 'bg-orange-100',  text: 'text-orange-700', dot: 'bg-orange-500' },
  cool: { label: '❄ Cool',  bg: 'bg-blue-100',    text: 'text-blue-700',   dot: 'bg-blue-500' },
  cold: { label: '⬛ Cold', bg: 'bg-slate-100',   text: 'text-slate-500',  dot: 'bg-slate-400' },
}
