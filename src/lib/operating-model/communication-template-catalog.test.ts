import { describe, expect, it } from 'vitest'
import { dispositionTaskDefinition } from '@/lib/dispo/operating-lifecycle'
import { WORKFLOW_CATALOG } from './workflow-catalog'
import {
  COMMUNICATION_TEMPLATE_CATALOG,
  communicationTemplateById,
  communicationTemplateBySlug,
  unresolvedCommunicationTemplateFields,
} from './communication-template-catalog'

describe('communication template catalog', () => {
  it('keeps stable unique identities for every approved standard', () => {
    const ids = COMMUNICATION_TEMPLATE_CATALOG.map((template) => template.id)
    const slugs = COMMUNICATION_TEMPLATE_CATALOG.map((template) => template.slug)

    expect(COMMUNICATION_TEMPLATE_CATALOG).toHaveLength(21)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
  })

  it('maps every template to a real workflow and operating task', () => {
    const workflowIds = new Set(WORKFLOW_CATALOG.map((workflow) => workflow.id))

    for (const template of COMMUNICATION_TEMPLATE_CATALOG) {
      expect(workflowIds.has(template.workflow_id), template.slug).toBe(true)
      expect(
        template.task_type.startsWith('acq.') || dispositionTaskDefinition(template.task_type) !== null,
        template.task_type,
      ).toBe(true)
    }
  })

  it('keeps deal-specific facts as reviewable merge fields', () => {
    for (const template of COMMUNICATION_TEMPLATE_CATALOG) {
      expect(template.subject.trim().length, template.slug).toBeGreaterThan(3)
      expect(template.body.trim().length, template.slug).toBeGreaterThan(40)
      expect(template.body).not.toMatch(/@gmail\.com/i)
      expect(unresolvedCommunicationTemplateFields(template.subject, template.body).length, template.slug).toBeGreaterThan(0)
    }
  })

  it('finds definitions and reports unresolved fields without duplicates', () => {
    const first = COMMUNICATION_TEMPLATE_CATALOG[0]
    expect(communicationTemplateById(first.id)?.slug).toBe(first.slug)
    expect(communicationTemplateBySlug(first.slug)?.id).toBe(first.id)
    expect(unresolvedCommunicationTemplateFields('{{seller_name}} at {{property_address}}', '{{seller_name}}')).toEqual([
      '{{seller_name}}',
      '{{property_address}}',
    ])
  })
})
