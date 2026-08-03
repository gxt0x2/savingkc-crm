export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createCommandAgent, commandAgentInstructions, readOperatingSnapshot } from '@/lib/ai/command-agent'
import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG } from '@/lib/operating-model/workflow-catalog'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

type CommandMessage = { role: 'user' | 'assistant'; content: string }

function cleanMessages(value: unknown): CommandMessage[] {
  if (!Array.isArray(value)) return []
  return value.slice(-20).flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const role = 'role' in message && (message.role === 'user' || message.role === 'assistant') ? message.role : null
    const content = 'content' in message && typeof message.content === 'string' ? message.content.trim().slice(0, 8_000) : ''
    return role && content ? [{ role, content }] : []
  })
}

function transcript(messages: CommandMessage[]) {
  return messages.map((message) => `${message.role === 'user' ? 'User' : 'ARI'}: ${message.content}`).join('\n\n')
}

async function directProviderReply(messages: CommandMessage[]) {
  const [snapshot] = await Promise.all([readOperatingSnapshot(30)])
  const context = {
    operatingSnapshot: snapshot,
    phoneSystem: PHONE_SYSTEM,
    workflows: WORKFLOW_CATALOG.map((workflow) => ({
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

  const response = groqKey
    ? await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...messages] }),
      })
    : await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openRouterKey}`, 'HTTP-Referer': 'https://crm.savingkc.com', 'X-Title': 'SavingKC AI Assistant' },
        body: JSON.stringify({ model: 'anthropic/claude-3.5-haiku', max_tokens: 900, temperature: 0.2, messages: [{ role: 'system', content: system }, ...messages] }),
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
      const result = await agent.generate({ prompt: transcript(messages) })
      reply = result.text
      provider = 'ai_gateway'
    } else {
      reply = await directProviderReply(messages)
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
