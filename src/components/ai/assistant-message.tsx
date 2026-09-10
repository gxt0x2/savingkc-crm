import { MessageResponse } from '@/components/ai-elements/message'
import { AssistantSources } from '@/components/ai/assistant-sources'
import type { AssistantSource } from '@/lib/ai/generation-store'

const PREVIEW_CHARACTER_LIMIT = 850
const MINIMUM_PREVIEW_CHARACTERS = 420

const RESPONSE_STYLES = [
  'min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[13px] leading-6 text-[var(--crm-ink)] sm:text-sm',
  '[&_p]:my-2.5 [&_p]:max-w-[72ch]',
  '[&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-black [&_h1]:tracking-tight',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[15px] [&_h2]:font-black',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-black',
  '[&_strong]:font-black [&_strong]:text-[var(--crm-ink)]',
  '[&_ul]:my-3 [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:space-y-2 [&_ol]:pl-5',
  '[&_li]:max-w-[70ch] [&_li]:pl-1 [&_li::marker]:font-black [&_li::marker]:text-[var(--crm-brand)]',
  '[&_a]:font-bold [&_a]:text-[var(--crm-info)] [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:max-w-full [&_code]:break-all [&_code]:rounded [&_code]:bg-[var(--crm-surface-subtle)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[.92em]',
  '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-[var(--crm-border)]',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--crm-brand)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--crm-text-muted)]',
  '[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto',
].join(' ')

export function splitAssistantMessage(content: string) {
  const clean = content.trim()
  if (clean.length <= PREVIEW_CHARACTER_LIMIT) return { preview: clean, details: '' }

  const previewWindow = clean.slice(0, PREVIEW_CHARACTER_LIMIT + 1)
  const boundaries = [...previewWindow.matchAll(/(?:\n\n|\n(?=#{1,6}\s)|[.!?](?:\s|$))/g)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index >= MINIMUM_PREVIEW_CHARACTERS && index <= PREVIEW_CHARACTER_LIMIT)
  const fallback = previewWindow.lastIndexOf(' ', PREVIEW_CHARACTER_LIMIT)
  const splitAt = boundaries.at(-1) ?? (fallback >= MINIMUM_PREVIEW_CHARACTERS ? fallback : PREVIEW_CHARACTER_LIMIT)

  return {
    preview: clean.slice(0, splitAt).trim(),
    details: clean.slice(splitAt).trim(),
  }
}

export function AssistantMessage({ content, sources }: { content: string; sources: AssistantSource[] }) {
  const message = splitAssistantMessage(content)

  return (
    <div className="min-w-0 max-w-full">
      <MessageResponse className={RESPONSE_STYLES}>{message.preview}</MessageResponse>
      {message.details ? (
        <details className="group mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]/70">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-xs font-black text-[var(--crm-ink)] marker:content-none">
            <span className="group-open:hidden">Read the supporting detail</span>
            <span className="hidden group-open:inline">Hide supporting detail</span>
            <span aria-hidden="true" className="text-base font-medium text-[var(--crm-text-muted)] transition group-open:rotate-45">+</span>
          </summary>
          <div className="min-w-0 border-t border-[var(--crm-border)] px-3.5 py-3">
            <MessageResponse className={`${RESPONSE_STYLES} text-[12px] text-[var(--crm-text-muted)] sm:text-[13px]`}>{message.details}</MessageResponse>
          </div>
        </details>
      ) : null}
      <AssistantSources sources={sources} />
    </div>
  )
}
