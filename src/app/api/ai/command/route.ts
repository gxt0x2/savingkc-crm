export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import type { ModelMessage } from 'ai'
import { createCommandAgent, commandAgentInstructions, readOperatingSnapshot, readWorkflowRegistry } from '@/lib/ai/command-agent'
import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

type CommandMessage = { role: 'user' | 'assistant'; content: string }
type CommandAttachment = { name: string; mediaType: string; dataUrl: string; base64: string; size: number }

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/json',
  'application/pdf',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/xml',
])

function cleanMessages(value: unknown): CommandMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(-20).flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const role = 'role' in message && (message.role === 'user' || message.role === 'assistant') ? message.role : null
    const content = 'content' in message && typeof message.content === 'string' ? message.content.trim().slice(0, 8_000) : ''
    return role && content ? [{ role, content }] : []
  })
}

function cleanAttachments(value: unknown): CommandAttachment[] {
  if (!Array.isArray(value)) return []
  let totalSize = 0
  return value.slice(0, 3).flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return []
    const name = 'name' in attachment && typeof attachment.name === 'string' ? attachment.name.trim().slice(0, 120) : ''
    const mediaType = 'mediaType' in attachment && typeof attachment.mediaType === 'string' ? attachment.mediaType.trim().toLowerCase() : ''
    const dataUrl = 'dataUrl' in attachment && typeof attachment.dataUrl === 'string' ? attachment.dataUrl : ''
    if (!name || !ALLOWED_ATTACHMENT_TYPES.has(mediaType)) throw new Error(`Unsupported attachment type: ${mediaType || 'unknown'}`)
    const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
    if (!match || match[1].toLowerCase() !== mediaType) throw new Error(`Attachment ${name} is not a valid ${mediaType} file.`)
    const base64 = match[2]
    const size = Buffer.byteLength(base64, 'base64')
    if (size > 2_000_000) throw new Error(`${name} is larger than the 2 MB attachment limit.`)
    totalSize += size
    if (totalSize > 3_000_000) throw new Error('Attachments exceed the 3 MB request limit.')
    return [{ name, mediaType, dataUrl, base64, size }]
  })
}

function transcript(messages: CommandMessage[]) {
  return messages.map((message) => `${message.role === 'user' ? 'User' : 'ARI'}: ${message.content}`).join('\n\n')
}

function gatewayMessages(messages: CommandMessage[], attachments: CommandAttachment[]): ModelMessage[] {
  const lastIndex = messages.length - 1
  return messages.map((message, index) => {
    if (message.role === 'user' && index === lastIndex && attachments.length > 0) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...attachments.map((attachment) => ({
            type: 'file' as const,
            data: { type: 'data' as const, data: attachment.base64 },
            filename: attachment.name,
            mediaType: attachment.mediaType,
          })),
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
}

function textAttachmentContext(attachments: CommandAttachment[]) {
  return attachments.flatMap((attachment) => {
    if (!(attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json')) return []
    const text = Buffer.from(attachment.base64, 'base64').toString('utf8').slice(0, 24_000)
    return [`Attached file ${attachment.name} (${attachment.mediaType}):\n${text}`]
  }).join('\n\n')
}

async function directProviderReply(messages: CommandMessage[], attachments: CommandAttachment[]) {
  const [snapshot, workflowRegistry] = await Promise.all([readOperatingSnapshot(30), readWorkflowRegistry()])
  const context = {
    operatingSnapshot: snapshot,
    phoneSystem: PHONE_SYSTEM,
    workflows: workflowRegistry.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      category: workflow.category,
      status: workflow.status,
      health: workflow.health,
      owner: workflow.owner.displayName,
      trigger: workflow.trigger,
      approvalPolicy: workflow.implementation.approvalPolicy,
      implementation: workflow.implementation.sourceFiles,
    })),
  }
  const system = `${commandAgentInstructions()}\n\nThe following live read-only context was loaded for this request:\n${JSON.stringify(context)}`
  const groqKey = process.env.GROQ_API_KEY
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!groqKey && !openRouterKey) throw new Error('No AI provider is configured')
  const binaryAttachments = attachments.filter((attachment) => !(attachment.mediaType.startsWith('text/') || attachment.mediaType === 'application/json'))
  if (binaryAttachments.some((attachment) => attachment.mediaType === 'application/pdf') || (binaryAttachments.length > 0 && !openRouterKey)) {
    throw new Error(binaryAttachments.some((attachment) => attachment.mediaType === 'application/pdf')
      ? 'PDF attachments require AI Gateway. Image, text, CSV, Markdown, and JSON attachments are available with the configured provider.'
      : 'Image attachments require AI Gateway or OpenRouter. Text, CSV, Markdown, and JSON attachments are available now.')
  }
  const attachmentContext = textAttachmentContext(attachments)
  const enrichedMessages = messages.map((message, index) => index === messages.length - 1 && message.role === 'user' && attachmentContext
    ? { ...message, content: `${message.content}\n\n${attachmentContext}` }
    : message)
  const openRouterMessages = enrichedMessages.map((message, index) => {
    if (message.role !== 'user' || index !== enrichedMessages.length - 1 || binaryAttachments.length === 0) return message
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...binaryAttachments.filter((attachment) => attachment.mediaType.startsWith('image/')).map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl } })),
      ],
    }
  })

  const response = groqKey && binaryAttachments.length === 0
    ? await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...enrichedMessages] }),
      })
    : await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://crm.savingkc.com', 'X-Title': 'SavingKC AI Assistant' },
        body: JSON.stringify({ model: 'anthropic/claude-3.5-haiku', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...openRouterMessages] }),
      })
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`)
  const data = await response.json()
  return data?.choices?.[0]?.message?.content?.trim() || 'No answer was returned.'
}

export async function POST(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const body = await request.json()
    const messages = cleanMessages(body.messages)
    const attachments = cleanAttachments(body.attachments)
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'A user request is required.' }, { status: 400 })
    }

    let reply: string
    let provider: 'ai_gateway' | 'configured_fallback'
    const gatewayAvailable = Boolean(
      process.env.AI_GATEWAY_API_KEY ||
      (process.env.VERCEL === '1' && process.env.VERCEL_OIDC_TOKEN),
    )
    if (gatewayAvailable) {
      const agent = createCommandAgent()
      const result = attachments.length > 0
        ? await agent.generate({ messages: gatewayMessages(messages, attachments) })
        : await agent.generate({ prompt: transcript(messages) })
      reply = result.text
      provider = 'ai_gateway'
    } else {
      reply = await directProviderReply(messages, attachments)
      provider = 'configured_fallback'
    }

    return NextResponse.json({
      reply,
      provider,
      grounded: true,
      execution: 'read_only',
      approvalRequiredFor: ['calls and messages', 'assignment', 'stage changes', 'workflow publishing', 'phone routing changes', 'deletes', 'spending'],
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[ai-command]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI command failed' }, { status: 500 })
  }
}
