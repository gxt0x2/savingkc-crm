export const OPERATING_DEPARTMENTS = ['acquisitions', 'dispositions', 'tc'] as const
export type OperatingDepartment = (typeof OPERATING_DEPARTMENTS)[number]

export function operatingDepartmentForStage(stage: string | null | undefined):
  'acquisitions' | 'dispositions' | 'transaction_coordination' | 'closed' {
  const normalized = stage?.trim().toLowerCase() || 'new'
  if (normalized === 'under_contract' || normalized === 'disposition') return 'dispositions'
  if (normalized === 'closing') return 'transaction_coordination'
  if (['closed_won', 'closed_lost', 'dead'].includes(normalized)) return 'closed'
  return 'acquisitions'
}

export function handoffDepartmentForWorkDepartment(department: OperatingDepartment):
  'acquisitions' | 'dispositions' | 'transaction_coordination' {
  return department === 'tc' ? 'transaction_coordination' : department
}

export function isOperatingDepartment(value: unknown): value is OperatingDepartment {
  return typeof value === 'string' && (OPERATING_DEPARTMENTS as readonly string[]).includes(value)
}
