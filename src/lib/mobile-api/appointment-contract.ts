export const MOBILE_APPOINTMENT_TYPES = ['phone_call', 'in_person', 'google_meet'] as const
export const MOBILE_APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled'] as const
export const MOBILE_APPOINTMENT_OUTCOMES = ['completed', 'no_show', 'cancelled'] as const

export type MobileAppointmentType = (typeof MOBILE_APPOINTMENT_TYPES)[number]
export type MobileAppointmentStatus = (typeof MOBILE_APPOINTMENT_STATUSES)[number]
export type MobileAppointmentOutcome = (typeof MOBILE_APPOINTMENT_OUTCOMES)[number]
export type MobileAppointmentProviderSyncStatus = 'not_configured' | 'pending' | 'synced' | 'failed'

export type MobileAppointment = {
  id: string
  leadId: string
  type: MobileAppointmentType
  status: MobileAppointmentStatus
  scheduledAt: string
  endsAt: string
  title: string
  location: string | null
  timeZone: string
  assignedTo: string | null
  notes: string | null
  sendReminder: boolean
  version: number
  source: string
  createdAt: string
  updatedAt: string
  sync: {
    reminders: 'enabled' | 'disabled'
    provider: MobileAppointmentProviderSyncStatus
    providerEventId: string | null
    providerSyncedAt: string | null
    providerError: string | null
  }
}

export type CreateMobileAppointmentInput = {
  leadId: string
  type: MobileAppointmentType
  scheduledAt: string
  endsAt: string
  title: string
  location: string | null
  timeZone: string
  assignedTo: string
  notes: string | null
  sendReminder: boolean
}

export type EditMobileAppointmentPatch = Partial<Pick<
  CreateMobileAppointmentInput,
  'type' | 'scheduledAt' | 'endsAt' | 'title' | 'location' | 'timeZone' | 'notes'
>>

export type RescheduleMobileAppointmentInput = Pick<
  CreateMobileAppointmentInput,
  'scheduledAt' | 'endsAt' | 'timeZone' | 'notes'
>

export type MobileAppointmentCommandResult = {
  success: true
  created: boolean
  changed: boolean
  replayed: boolean
  appointment: MobileAppointment
  activityId: string | null
  sideEffects: {
    lifecycle: 'advanced' | 'unchanged' | 'failed' | 'not_applicable'
    conversion: 'queued' | 'skipped' | 'failed' | 'not_applicable'
    reminders: 'enabled' | 'disabled'
    provider: MobileAppointmentProviderSyncStatus
  }
  warning?: string
}
