export const DETERMINISTIC_FIXTURE_SET_ID =
  '00000000-0000-4000-8000-000000000040'
export const DETERMINISTIC_MODEL_ID = 'deterministic-guards'
export const REQUIRED_ESCALATIONS = [
  'identity',
  'unsupported_claim',
  'pricing',
  'legal',
  'sensitive',
  'conflicting_facts',
  'possible_opt_out',
  'unsupported_language',
  'requested_human',
  'limits',
  'untrusted_instruction',
  'unclear',
] as const
