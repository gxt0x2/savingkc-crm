import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const retiredAriRoutes = [
  'src/app/api/ari/briefing/route.ts',
  'src/app/api/ari/call-queue/route.ts',
  'src/app/api/ari/coaching/route.ts',
  'src/app/api/ari/follow-ups/route.ts',
  'src/app/api/ari/inbox/route.ts',
  'src/app/api/ari/pipeline-actions/route.ts',
]

describe('governed AI runtime', () => {
  it('uses one governed tool path with Groq text capacity and Gateway attachment compatibility', () => {
    const route = read('src/app/api/ai/command/route.ts')
    const agent = read('src/lib/ai/command-agent.ts')

    expect(route).not.toContain('api.groq.com')
    expect(route).not.toContain('openrouter.ai')
    expect(route).not.toContain('directProviderReply')
    expect(route).toContain("if (attachments.length === 0 && groqAvailable) return 'groq'")
    expect(route).toContain("if (gatewayAvailable) return 'gateway'")
    expect(route).toContain("AssistantGenerationError('ai_provider_unavailable', 503")
    expect(agent).toContain("baseURL: 'https://api.groq.com/openai/v1'")
    expect(agent).toContain('model: commandModel(provider)')
  })

  it('keeps the retired ARI operational stack out of runtime source', () => {
    const registry = JSON.parse(read('src/config/system-registry.json')) as {
      policies: { retiredRuntimeRoutes: Array<{ path: string }> }
      features: Array<{ id: string; environment: string[] }>
    }
    const registered = new Set(registry.policies.retiredRuntimeRoutes.map((item) => item.path))

    for (const path of retiredAriRoutes) {
      expect(existsSync(resolve(root, path)), path).toBe(false)
      expect(registered.has(path), path).toBe(true)
    }
    expect(existsSync(resolve(root, 'src/hooks/use-ari-page.ts'))).toBe(false)
    expect(existsSync(resolve(root, 'src/hooks/use-ari.ts'))).toBe(false)
    expect(readFileNames('src/components/ari')).toEqual([])

    const assistant = registry.features.find((feature) => feature.id === 'unified_ai_assistant')
    expect(assistant?.environment).toEqual(['GROQ_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'])
  })
})

function readFileNames(path: string): string[] {
  if (!existsSync(resolve(root, path))) return []
  return readdirSync(resolve(root, path))
}
