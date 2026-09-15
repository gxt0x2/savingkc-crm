export const LEAD_WORKSPACE_STAGES = [
  { keys: ['new', 'intake', 'not_contacted'], label: 'New' },
  { keys: ['contacted', 'lead', 'leads', 'attempting_contact'], label: 'Contacted' },
  { keys: ['qualified', 'qualifying', 'opportunity', 'discovery'], label: 'Opportunity' },
  { keys: ['appointment_set', 'appt_set', 'appointment'], label: 'Appointment set' },
  { keys: ['offer_made', 'offer', 'offer_prep', 'offer_presented', 'negotiating', 'negotiations'], label: 'Offer' },
  { keys: ['under_contract', 'in_closing', 'contract', 'contract_signed', 'inspection', 'closing_prep', 'closing'], label: 'Contract' },
] as const

export function leadWorkspaceStageIndex(station: string | null | undefined): number {
  const normalized = (station || 'new').trim().toLowerCase()
  return LEAD_WORKSPACE_STAGES.findIndex((stage) => (stage.keys as readonly string[]).includes(normalized))
}

export function leadWorkspaceStageLabel(station: string | null | undefined): string {
  const index = leadWorkspaceStageIndex(station)
  if (index >= 0) return LEAD_WORKSPACE_STAGES[index].label
  return station?.trim() ? station.trim().replace(/_/g, ' ') : 'New'
}

export function resolveLeadWorkspaceStage(
  station: string | null | undefined,
  hasGovernedAppointment: boolean,
): { index: number; label: string; appointmentDerived: boolean } {
  const savedIndex = leadWorkspaceStageIndex(station)
  const appointmentIndex = LEAD_WORKSPACE_STAGES.findIndex((stage) => stage.label === 'Appointment set')
  if (hasGovernedAppointment && savedIndex >= 0 && savedIndex < appointmentIndex) {
    return {
      index: appointmentIndex,
      label: LEAD_WORKSPACE_STAGES[appointmentIndex].label,
      appointmentDerived: true,
    }
  }
  return {
    index: savedIndex,
    label: leadWorkspaceStageLabel(station),
    appointmentDerived: false,
  }
}
