import { describe, expect, it } from 'vitest'
import {
  handoffDepartmentForWorkDepartment,
  isOperatingDepartment,
  operatingDepartmentForStage,
} from './department-responsibility'

describe('department responsibility', () => {
  it.each([
    ['new', 'acquisitions'],
    ['contacted', 'acquisitions'],
    ['offer_made', 'acquisitions'],
    ['under_contract', 'dispositions'],
    ['closing', 'transaction_coordination'],
    ['closed_won', 'closed'],
  ])('maps %s to %s', (stage, department) => {
    expect(operatingDepartmentForStage(stage)).toBe(department)
  })

  it('uses the canonical TC handoff label without exposing it as a task filter', () => {
    expect(isOperatingDepartment('tc')).toBe(true)
    expect(isOperatingDepartment('transaction_coordination')).toBe(false)
    expect(handoffDepartmentForWorkDepartment('tc')).toBe('transaction_coordination')
  })
})
