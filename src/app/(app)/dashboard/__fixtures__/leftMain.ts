const currentRates = Object.freeze({
  leadQualification: 0.3,
  opportunityToAppointment: 0.6,
  opportunityToContract: 0.2,
  contractToAssignment: 0.6,
  assignmentToClosing: 0.8,
})

const optimizedRates = Object.freeze({
  leadQualification: 0.4,
  opportunityToAppointment: 0.6,
  opportunityToContract: 0.2,
  contractToAssignment: 0.8,
  assignmentToClosing: 0.8,
})

export const LEFT_MAIN_FIXTURE = Object.freeze({
  source: 'IMG_0713',
  current: Object.freeze({
    label: 'Current State',
    inputs: Object.freeze({
      averageDealMargin: 10000,
      totalLeads: 100,
      rates: currentRates,
    }),
    expected: Object.freeze({
      stageCounts: Object.freeze({
        leadQualification: 30,
        opportunityToAppointment: 18,
        opportunityToContract: 3.6,
        contractToAssignment: 2.16,
        assignmentToClosing: 1.728,
      }),
      closedWonRate: 0.01728,
      closedDeals: 1.728,
      grossRevenue: 17280,
    }),
    display: Object.freeze({
      closedDeals: '1.73',
      closedWonRate: '1.73%',
      grossRevenue: '$17,280',
    }),
  }),
  optimized: Object.freeze({
    label: 'Optimized State',
    inputs: Object.freeze({
      averageDealMargin: 10000,
      totalLeads: 100,
      rates: optimizedRates,
    }),
    expected: Object.freeze({
      stageCounts: Object.freeze({
        leadQualification: 40,
        opportunityToAppointment: 24,
        opportunityToContract: 4.8,
        contractToAssignment: 3.84,
        assignmentToClosing: 3.072,
      }),
      closedWonRate: 0.03072,
      closedDeals: 3.072,
      grossRevenue: 30720,
    }),
    display: Object.freeze({
      closedDeals: '3.07',
      closedWonRate: '3.07%',
      grossRevenue: '$30,720',
    }),
  }),
  comparison: Object.freeze({
    expected: Object.freeze({
      revenueIncreasePercent: 77.77777777777779,
      netIncrease: 13440,
    }),
    display: Object.freeze({
      revenueIncreasePercent: '77.78%',
      netIncrease: '$13,440',
    }),
  }),
} as const)
