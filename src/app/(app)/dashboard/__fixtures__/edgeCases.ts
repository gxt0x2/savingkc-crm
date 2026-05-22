export const ZERO_LEADS_SCENARIO = Object.freeze({
  averageDealMargin: 10000,
  totalLeads: 0,
  rates: Object.freeze({
    leadQualification: 0.3,
    opportunityToAppointment: 0.6,
    opportunityToContract: 0.2,
    contractToAssignment: 0.6,
    assignmentToClosing: 0.8,
  }),
} as const)

export const ALL_RATES_AT_100_SCENARIO = Object.freeze({
  averageDealMargin: 10000,
  totalLeads: 100,
  rates: Object.freeze({
    leadQualification: 1,
    opportunityToAppointment: 1,
    opportunityToContract: 1,
    contractToAssignment: 1,
    assignmentToClosing: 1,
  }),
} as const)

export const ALL_RATES_AT_0_SCENARIO = Object.freeze({
  averageDealMargin: 10000,
  totalLeads: 100,
  rates: Object.freeze({
    leadQualification: 0,
    opportunityToAppointment: 0,
    opportunityToContract: 0,
    contractToAssignment: 0,
    assignmentToClosing: 0,
  }),
} as const)
