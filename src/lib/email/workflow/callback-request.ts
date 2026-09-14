import { practiceReply } from './presentation'

/** Deterministic routing evidence, never permission to send or dial. */
function authoredText(body: string) {
  return body.split(/\n(?:On .+wrote:|From:|--\s*$|Sent from my)/im)[0].split('\n').filter(line => !line.trim().startsWith('>')).join('\n').trim()
}
export function isCallbackTest(body: string) {
  return /\b(system test|test only|false number|fake number|dummy number)\b/i.test(authoredText(body))
}
export function callbackRequest(body: string) {
  const authored = authoredText(body)
  const proposal = practiceReply(authored)
  if (!proposal.phone ||
    /\b(do not|don't|never)\s+(?:contact|call|phone)|\b(no calls|stop calling|do not email|don't email|no more emails)\b/i.test(authored)) return null
  return { phone: proposal.phone, time: proposal.time, explicitCall: /\b(call me|give me a call|reach me)\b/i.test(authored),
    testOnly: isCallbackTest(authored) }
}
