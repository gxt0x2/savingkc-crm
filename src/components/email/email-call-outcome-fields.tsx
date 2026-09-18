'use client'

export type EmailCallOutcome =
  | 'conversation_complete'
  | 'follow_up'
  | 'no_contact'
  | 'not_qualified'
  | 'controlled_test_complete'

export function EmailCallOutcomeFields({
  campaignName,
  outcomeKind,
  setOutcomeKind,
  outcome,
  setOutcome,
  nextAction,
  setNextAction,
  outcomeDue,
  setOutcomeDue,
  blocked,
}: {
  campaignName: string
  outcomeKind: EmailCallOutcome
  setOutcomeKind: (value: EmailCallOutcome) => void
  outcome: string
  setOutcome: (value: string) => void
  nextAction: string
  setNextAction: (value: string) => void
  outcomeDue: string
  setOutcomeDue: (value: string) => void
  blocked: boolean
}) {
  const remainsOpen = outcomeKind === 'follow_up' || outcomeKind === 'no_contact'
  const controlled = outcomeKind === 'controlled_test_complete'
  return (
    <>
      <label>
        Result
        <select
          aria-label="Call result"
          value={outcomeKind}
          onChange={(event) => setOutcomeKind(event.target.value as EmailCallOutcome)}
        >
          <option value="conversation_complete">Conversation complete</option>
          <option value="follow_up">Follow-up needed</option>
          <option value="no_contact">No contact</option>
          <option value="not_qualified">Not a fit for this outreach</option>
          {campaignName === 'Controlled setup test' && (
            <option value="controlled_test_complete">Controlled test complete (no call)</option>
          )}
        </select>
      </label>
      <label>
        {controlled ? 'Test notes' : 'Call outcome'}
        <textarea
          aria-label={controlled ? 'Test notes' : 'Call outcome'}
          rows={2}
          required
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          maxLength={2000}
        />
      </label>
      {remainsOpen && (
        <>
          <label>
            Next action
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            Next action time (Chicago)
            <input
              type="datetime-local"
              value={outcomeDue}
              onChange={(event) => setOutcomeDue(event.target.value)}
              required
            />
          </label>
        </>
      )}
      <button disabled={blocked || !outcome.trim() || (remainsOpen && (!nextAction.trim() || !outcomeDue))}>
        {remainsOpen ? 'Save outcome & follow-up' : controlled ? 'Complete test' : 'Complete callback'}
      </button>
      <small>
        {remainsOpen
          ? 'Keeps this callback open with its next action.'
          : controlled
            ? 'Closes this controlled test and records that no seller call occurred.'
            : 'Completes this callback only. The CRM stage stays unchanged.'}
      </small>
    </>
  )
}
