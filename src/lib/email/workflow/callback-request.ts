import { authoredReplyText } from '../reply-text'
import { practiceReply } from './presentation'

export function isCallbackTest(body: string) {
  return /\b(system test|test only|false number|fake number|dummy number)\b/i.test(authoredReplyText(body))
}
export function callbackRequest(body: string) {
  const authored = authoredReplyText(body)
  const proposal = practiceReply(authored)
  if (!proposal.phone ||
    /\b(do not|don't|never)\s+(?:contact|call|phone)|\b(no calls|stop calling|do not email|don't email|no more emails)\b/i.test(authored)) return null
  return { phone: proposal.phone, time: proposal.time, explicitCall: /\b(call me|give me a call|reach me)\b/i.test(authored),
    testOnly: isCallbackTest(authored) }
}
