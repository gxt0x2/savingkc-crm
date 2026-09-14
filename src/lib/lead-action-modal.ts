export type LeadActionModal = 'appointment' | 'task' | null

export type LeadActionModalAction =
  | { type: 'open'; modal: Exclude<LeadActionModal, null> }
  | { type: 'close' }

export function leadActionModalReducer(
  _current: LeadActionModal,
  action: LeadActionModalAction,
): LeadActionModal {
  return action.type === 'open' ? action.modal : null
}
