import { authoredReplyText } from './reply-text'

/** Classify explicit email stops, never quoted footer text or property-removal requests. */
export function isOptOutReply(body: string) {
  const text = authoredReplyText(body).replace(/[’]/g, "'")
  // Evaluate each authored line: a normal signature must not hide a short stop request.
  return text.split('\n').some(raw => {
    const line = raw.trim()
    if (/\b(?:don't|do not|never)\s+(?:unsubscribe|remove)\s+me\b/i.test(line)) return false
    return /\b(?:unsubscribe me|stop (?:emailing|sending (?:me )?emails)|remove me|take me off|do not email|don't email|no more emails|stop contacting me|do not contact me|don't contact me)\b/i.test(line)
      || /^(?:(?:please|kindly)\s+)?(?:stop|remove|unsubscribe)(?:\s+please)?[.! ,]*(?:(?:thanks|thank you)[.! ]*)?$/i.test(line)
  })
}
