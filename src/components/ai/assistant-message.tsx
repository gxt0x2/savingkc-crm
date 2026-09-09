import { AssistantSources } from '@/components/ai/assistant-sources'
import type { AssistantSource } from '@/lib/ai/generation-store'

const PREVIEW_CHARACTER_LIMIT = 1_000
const MINIMUM_PREVIEW_CHARACTERS = 500

export function splitAssistantMessage(content: string) {
  const clean = content.trim()
  if (clean.length <= PREVIEW_CHARACTER_LIMIT) return { preview: clean, details: '' }

  const window = clean.slice(0, PREVIEW_CHARACTER_LIMIT + 1)
  const boundaries = [...window.matchAll(/(?:\n\n|\n|[.!?](?:\s|$))/g)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index >= MINIMUM_PREVIEW_CHARACTERS && index <= PREVIEW_CHARACTER_LIMIT)
  const fallback = window.lastIndexOf(' ', PREVIEW_CHARACTER_LIMIT)
  const splitAt = boundaries.at(-1) ?? (fallback >= MINIMUM_PREVIEW_CHARACTERS ? fallback : PREVIEW_CHARACTER_LIMIT)

  return {
    preview: clean.slice(0, splitAt).trim(),
    details: clean.slice(splitAt).trim(),
  }
}

export function AssistantMessage({ content, sources }: { content: string; sources: AssistantSource[] }) {
  const message = splitAssistantMessage(content)

  return (
    <>
      <p className="whitespace-pre-wrap">{message.preview}</p>
      {message.details ? (
        <details className="group mt-2 border-t border-[var(--crm-border)] pt-2">
          <summary className="cursor-pointer list-none text-xs font-black text-[var(--crm-brand)] hover:underline">
            <span className="group-open:hidden">Show details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[var(--crm-text-muted)]">{message.details}</p>
        </details>
      ) : null}
      <AssistantSources sources={sources} />
    </>
  )
}
