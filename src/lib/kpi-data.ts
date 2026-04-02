/** Casey's YTD cold-calling KPIs from the KPI Tracker spreadsheet.
 *  Source: "KPI Tracker - Jr. Acquisitions.xlsx"
 *  Updated: 2026-04-01 (covers Jan–Mar 2026)
 */

export interface MonthlyKpis {
  month: string
  dialTimeHrs: number
  calls: number
  contacts: number
  leads: number
  appointments: number
  dailyHabits: {
    reviewVision: number
    objectionsHandling: number
    followUp: number
    callingMinimum: number
  }
}

export const CASEY_MONTHLY_KPIS: MonthlyKpis[] = [
  {
    month: 'Jan 2026',
    dialTimeHrs: 29.8,
    calls: 3916,
    contacts: 221,
    leads: 6,
    appointments: 2,
    dailyHabits: { reviewVision: 340, objectionsHandling: 340, followUp: 340, callingMinimum: 320 },
  },
  {
    month: 'Feb 2026',
    dialTimeHrs: 45.7,
    calls: 3521,
    contacts: 227,
    leads: 16,
    appointments: 0,
    dailyHabits: { reviewVision: 400, objectionsHandling: 380, followUp: 380, callingMinimum: 360 },
  },
  {
    month: 'Mar 2026',
    dialTimeHrs: 26.7,
    calls: 3168,
    contacts: 147,
    leads: 5,
    appointments: 1,
    dailyHabits: { reviewVision: 405, objectionsHandling: 405, followUp: 285, callingMinimum: 140 },
  },
]

export function getYtdTotals() {
  const totals = CASEY_MONTHLY_KPIS.reduce(
    (acc, m) => ({
      dialTimeHrs: acc.dialTimeHrs + m.dialTimeHrs,
      calls: acc.calls + m.calls,
      contacts: acc.contacts + m.contacts,
      leads: acc.leads + m.leads,
      appointments: acc.appointments + m.appointments,
    }),
    { dialTimeHrs: 0, calls: 0, contacts: 0, leads: 0, appointments: 0 }
  )

  const contactRate = totals.calls > 0 ? ((totals.contacts / totals.calls) * 100).toFixed(1) : '0'
  const leadRate = totals.contacts > 0 ? ((totals.leads / totals.contacts) * 100).toFixed(1) : '0'

  return { ...totals, contactRate, leadRate, months: CASEY_MONTHLY_KPIS.length }
}
