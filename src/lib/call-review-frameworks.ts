export type CallReviewFrameworkId = 'junior_acquisitions' | 'niche'

export type CallReviewFramework = {
  id: CallReviewFrameworkId
  label: string
  sections: Array<{ label: string; items: Array<{ id: string; label: string }> }>
}

export const CALL_REVIEW_TAGS = ['Great Call', 'Needs Coaching', 'Motivation', 'Property Condition', 'Timeline', 'Price', 'Objections', 'Appointment Setting'] as const

export const CALL_SCORE_RUBRIC = [
  { value: 0, label: 'Missed', description: 'Not demonstrated' },
  { value: 1, label: 'Attempted', description: 'Attempted but incomplete or inconsistent' },
  { value: 2, label: 'Meets Standard', description: 'Clear, complete, and effective' },
  { value: 3, label: 'Excellent', description: 'Intentional, natural, and repeatable' },
] as const

export const CALL_REVIEW_FRAMEWORKS: CallReviewFramework[] = [
  {
    id: 'junior_acquisitions',
    label: 'Jr. Acquisitions Scorecard',
    sections: [
      { label: 'Introduction', items: [['seller_name', 'Used seller’s name'], ['rep_name', 'Introduced themselves'], ['permission', 'Asked permission to continue']] },
      { label: 'Motivation / Discovery', items: [['why_now', 'Asked why now'], ['deeper_one', 'Asked one question deeper'], ['deeper_two', 'Asked one question more'], ['whats_next', 'Asked what happens next'], ['understanding', 'Demonstrated understanding']] },
      { label: 'Property Condition', items: [['occupancy', 'Confirmed occupied or vacant'], ['condition', 'Explored overall condition'], ['trouble_areas', 'Identified trouble areas or issues']] },
      { label: 'Timeline & Price', items: [['timeline', 'Established desired timeline'], ['timing_reason', 'Asked what makes now right'], ['liens', 'Covered mortgage, taxes, and liens'], ['price_three', 'Asked for price thoroughly'], ['walkaway', 'Asked needed walk-away amount'], ['price_received', 'Received a price']] },
      { label: 'Decision Process', items: [['decision_makers', 'Confirmed all decision makers'], ['other_options', 'Explored agents and investors'], ['push_away', 'Used a push-away'], ['why_us', 'Asked why SavingKC'], ['blockers', 'Identified remaining blockers']] },
      { label: 'Summary & Solution', items: [['primary_pain', 'Summarized primary motivation'], ['secondary_pain', 'Summarized secondary motivation'], ['desired_outcome', 'Confirmed desired outcome'], ['commitment', 'Acknowledged commitment'], ['next_step', 'Clearly stated the next step']] },
      { label: 'Appointment Setting', items: [['date_time', 'Confirmed date and time'], ['before_next', 'Defined what happens before next contact'], ['when_happens', 'Confirmed when required actions will happen'], ['next_conversation', 'Defined what happens in the next conversation'], ['questions_thanks', 'Invited questions and thanked seller']] },
    ].map((section) => ({ ...section, items: section.items.map(([id, label]) => ({ id, label })) })),
  },
  {
    id: 'niche',
    label: 'Niche Framework',
    sections: [
      { label: 'Opening', items: [['niche_intro', 'Used the correct source-specific intro'], ['bad_time', 'Asked if it was a bad time'], ['purpose', 'Explained the purpose clearly'], ['catch_up', 'Invited the seller to catch them up']] },
      { label: 'Path Forward', items: [['situation', 'Explored what changed'], ['goal', 'Identified the seller’s goal'], ['attempts', 'Asked what they have tried'], ['options', 'Explored the relevant resolution options']] },
      { label: 'Pain & Wants', items: [['past_pain', 'Explored past pain'], ['present_pain', 'Explored present pain'], ['future_pain', 'Explored future risk and backup plan'], ['walk_amount', 'Asked desired walk-away amount'], ['support', 'Asked about moving or housing support'], ['time_needed', 'Confirmed time needed']] },
      { label: 'Proof of Life', items: [['niche_decisions', 'Identified decision makers and influencers'], ['competition', 'Asked who else they have talked to'], ['why_meet', 'Established why meeting with SavingKC matters']] },
      { label: 'Summary & Appointment', items: [['niche_summary', 'Reflected the seller’s situation accurately'], ['niche_solution', 'Connected the solution to their goal'], ['appointment', 'Asked for the appointment'], ['appointment_blocker', 'Checked for appointment blockers'], ['forward_commitment', 'Tested willingness to move forward'], ['confirmed_details', 'Confirmed time, place, email, and next contact']] },
    ].map((section) => ({ ...section, items: section.items.map(([id, label]) => ({ id, label })) })),
  },
]

export function getCallReviewFramework(value: unknown): CallReviewFramework | null {
  return CALL_REVIEW_FRAMEWORKS.find((framework) => framework.id === value) ?? null
}
