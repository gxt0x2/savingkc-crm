export type MessageTemplate = {
  id: string
  name: string
  category: string
  body: string
  merge_fields: string[]
}

export type MessageTemplateContext = {
  fullName?: string | null
  propertyAddress?: string | null
  agentName?: string | null
}

const TOKENS: Record<string, keyof MessageTemplateContext> = {
  '{firstName}': 'fullName',
  '{{first_name}}': 'fullName',
  '{fullName}': 'fullName',
  '{{full_name}}': 'fullName',
  '{propertyAddress}': 'propertyAddress',
  '{{property_address}}': 'propertyAddress',
  '{agentName}': 'agentName',
  '{{agent_name}}': 'agentName',
}

const TOKEN_PATTERN = /{{[^{}]+}}|{[^{}]+}/g

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || ''
}

export function renderMessageTemplate(body: string, context: MessageTemplateContext) {
  const missing = new Set<string>()
  const unsupported = new Set<string>()
  const rendered = body.replace(TOKEN_PATTERN, (token) => {
    const field = TOKENS[token]
    if (!field) {
      unsupported.add(token)
      return token
    }
    const value = context[field]?.trim() || ''
    if (!value) {
      missing.add(field)
      return token
    }
    return token === '{firstName}' || token === '{{first_name}}' ? firstName(value) : value
  })
  return { rendered, missing: [...missing], unsupported: [...unsupported], ready: missing.size === 0 && unsupported.size === 0 }
}

export function messageTemplateName(name: string) {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}
