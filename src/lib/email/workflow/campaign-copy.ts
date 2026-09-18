import 'server-only'
import { check, type Tx } from './core'
import type { PilotConfig } from './types'

export type RenderedStep = { subject: string; body: string }
const tokens = ['first_name', 'property_address', 'property_question']
export function validateCampaignCopy(steps: PilotConfig['steps']) {
  for (const step of steps) {
    const remainder = (step.subject + step.bodyTemplate).replace(/\{\{([a-z_]+)\}\}/g, (match, key) => tokens.includes(key) ? '' : match)
    check(!/[{}]/.test(remainder), 'UNSUPPORTED_PERSONALIZATION_FIELD', 400)
    check(!/[\r\n]/.test(step.subject), 'INVALID_SUBJECT', 400)
  }
}

/** Reviewed facts only. No inference of inheritance, debt, motivation or authority. */
export async function renderCampaignCopy(tx: Tx, workspaceId: string, partyId: string, steps: PilotConfig['steps']): Promise<RenderedStep[]> {
  validateCampaignCopy(steps)
  const template = steps.map(s => s.subject + s.bodyTemplate).join('\n')
  if (!template.includes('{{')) return steps.map(s => ({ subject: s.subject, body: s.bodyTemplate }))
  const [person] = await tx`select display_name,identity_state from em_parties where workspace_id=${workspaceId} and id=${partyId}`
  check(person?.identity_state === 'confirmed', 'PERSONALIZATION_IDENTITY_REQUIRED')
  const firstName = String(person.display_name).trim().split(/\s+/)[0]
  check(/^[\p{L}][\p{L}'’.-]*$/u.test(firstName) && !/\b(estate|trust|unknown|controlled)\b/i.test(firstName), 'PERSONALIZATION_NAME_REQUIRED')
  const properties = await tx`select address,relationship,evidence from em_party_properties where workspace_id=${workspaceId} and party_id=${partyId} and canonical_property_id is not null and relationship in ('owner','representative','heir') order by id`
  check(properties.length === 1 && properties[0].address?.trim() && Object.keys(properties[0].evidence ?? {}).length > 0, 'PERSONALIZATION_PROPERTY_REQUIRED')
  const property = properties[0]
  const fields: Record<string,string> = {
    first_name: firstName,
    property_address: String(property.address).trim(),
    property_question: property.relationship === 'heir'
      ? 'If your family is still deciding what to do with the property, would selling be worth a conversation?'
      : 'Are you the right person to speak with about the property? If selling is being considered, I’d be happy to talk through what that could look like.',
  }
  check(Object.values(fields).every(v => !/[\r\n{}\u0000]/.test(v)), 'PERSONALIZATION_FACT_REVIEW')
  const render = (value: string) => value.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => fields[key])
  return steps.map(s => ({ subject: render(s.subject), body: render(s.bodyTemplate) }))
}
