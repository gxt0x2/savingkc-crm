export function handoffHelp(reason: string | null) {
  const help: Record<string, string> = {
    identity_unconfirmed: 'Confirm who replied and link their contact record, then review this callback again.',
    contact_identity_conflict: 'The email matches conflicting contacts. Choose the correct contact before creating the Lead.',
    property_unconfirmed: 'Confirm the property this person owns or represents, then review the callback again.',
    property_ambiguous: 'More than one property or CRM record matches. Resolve the match before creating another Lead.',
    owner_conflict: 'This person already has a CRM owner. Route the callback to that owner or resolve the assignment.',
    governed_transition_required: 'An existing contact needs a Pipeline status decision. Update that record, then retry the callback review.',
    existing_record_held: 'The existing CRM record is closed or parked. Review its status before reopening sales work.',
    seller_interest_unconfirmed: 'Confirm that this reply is a seller inquiry before adding it to Pipeline.',
    canonical_dependency_missing: 'CRM task creation is unavailable. Ask the workspace owner to repair the connection and retry.',
    schema_incompatible: 'CRM setup needs repair. Ask the workspace owner to review the connection.',
  }
  return help[reason ?? ''] ?? 'Callback held for review. Resolve the hold before calling.'
}
