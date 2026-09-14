import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { z } from 'zod'

export const receivedContentSchema = z.object({
  id: z.string().uuid(),
  from: z.string().email(),
  to: z.array(z.string().email()).max(100),
  received_for: z.array(z.string().email()).max(100).optional(),
  created_at: z.string().datetime(),
  subject: z.string().max(2000),
  message_id: z.string().min(1).max(1000),
  text: z.string().max(1000000).nullable().optional(),
  html: z.string().max(1000000).nullable().optional(),
  headers: z.record(z.string().max(16000)).default({}),
  attachments: z
    .array(
      z.object({
        id: z.string().uuid(),
        filename: z.string().max(1000).nullable().optional(),
        content_type: z.string().max(200),
        size: z.number().nonnegative().optional(),
      }),
    )
    .max(100)
    .default([]),
})
export type ReceivedContent = z.infer<typeof receivedContentSchema>
export function authoredReplyText(body: string) {
  return body
    .split(/\n(?:On .+wrote:|From:|--\s*$|Sent from my)/im)[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .trim()
}
export function isOptOutReply(body: string) {
  const authored = authoredReplyText(body)
  return (
    /\b(unsubscribe|stop emailing|remove me|do not email|don't email|no more emails)\b/i.test(
      authored,
    ) || /^(?:stop|remove)[.!\s]*$/i.test(authored)
  )
}
export function normalizeReceivedContent(raw: unknown) {
  const content = receivedContentSchema.parse(raw)
  let text = content.text?.trim() ?? ''
  if (!text && content.html) {
    const parts: string[] = []
    const pending: { node: DefaultTreeAdapterTypes.Node; quoted: boolean }[] = [
      { node: parse(content.html), quoted: false },
    ]
    while (pending.length) {
      const entry = pending.pop()!
      const node = entry.node
      const quoted =
        entry.quoted ||
        ('tagName' in node &&
          (node.tagName === 'blockquote' ||
            node.attrs.some(
              (a) =>
                (a.name === 'class' &&
                  /gmail_quote|yahoo_quoted/.test(a.value)) ||
                (a.name === 'id' && a.value === 'divRplyFwdMsg'),
            )))
      if (
        'tagName' in node &&
        [
          'script',
          'style',
          'head',
          'template',
          'noscript',
          'svg',
          'math',
        ].includes(node.tagName)
      )
        continue
      if (node.nodeName === '#text' && 'value' in node)
        parts.push(
          quoted ? '\n> ' + node.value.replace(/\n/g, '\n> ') : node.value,
        )
      if (
        'tagName' in node &&
        ['p', 'div', 'br', 'li', 'tr', 'blockquote', 'hr'].includes(
          node.tagName,
        )
      )
        parts.push('\n')
      if ('childNodes' in node)
        for (const child of [...node.childNodes].reverse())
          pending.push({ node: child, quoted })
    }
    text = parts
      .join('')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  if (!text || text.length > 100000)
    throw new Error('REPLY_CONTENT_REVIEW_REQUIRED')
  const headers = Object.fromEntries(
    Object.entries(content.headers).map(([k, v]) => [k.toLowerCase(), v]),
  )
  return {
    ...content,
    text,
    headers,
    optOut: isOptOutReply(text),
    attachments: content.attachments.map((a) => ({
      ...a,
      filename:
        a.filename?.replace(/[\u0000-\u001f\u007f]/g, '') ??
        'Unnamed attachment',
    })),
  }
}
