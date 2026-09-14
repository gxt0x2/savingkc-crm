/** Extract authored text before common reply headers, including wrapped Gmail headers. */
export function authoredReplyText(body: string) {
  return body.replace(/\r\n?/g, '\n')
    .split(/(?:^|\n)(?:On [^\n]*(?:\n[^\n]*){0,4}?wrote:\s*(?:\n|$)|From:|--\s*$|Sent from my)/im)[0]
    .split('\n').filter(line => !line.trim().startsWith('>')).join('\n').trim()
}
