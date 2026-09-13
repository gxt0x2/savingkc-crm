import {describe,it,expect} from 'vitest'
import { normalizeReceivedContent,isOptOutReply } from '../inbound/content'
const fixture={id:'11111111-1111-4111-8111-111111111111',from:'seller@example.test',to:['reply@example.test'],created_at:'2026-09-14T15:00:00Z',subject:'Reply',message_id:'<example@test>'}
describe('received message normalization',()=>{
  it('turns HTML into text without running scripts, embedding images or following links',()=>{
    const result=normalizeReceivedContent({...fixture,html:'<html><head><style>hidden</style></head><body><p>Call &amp; talk.</p><script>alert(1)</script><img src="https://tracker.test"><p>Tomorrow works.</p></body></html>'})
    expect(result.text).toBe('Call & talk.\nTomorrow works.')
    expect(result.text).not.toMatch(/alert|tracker|hidden/)
  })
  it('prefers the plain text version and strips controls from attachment names',()=>{
    expect(normalizeReceivedContent({...fixture,text:'Plain reply',html:'Different reply',attachments:[{id:fixture.id,filename:'a\u0000.pdf',content_type:'application/pdf'}]})).toMatchObject({text:'Plain reply',attachments:[{filename:'a.pdf'}]})
  })
  it('does not infer opt-out from quoted history or an email signature',()=>{
    expect(isOptOutReply('Tomorrow works.\n> unsubscribe')).toBe(false)
    expect(normalizeReceivedContent({...fixture,html:'<p>Tomorrow works.</p><blockquote><p>unsubscribe</p><p>remove me</p></blockquote>'}).optOut).toBe(false)
    expect(isOptOutReply('Yes.\nOn Monday someone wrote:\nunsubscribe')).toBe(false)
    expect(isOptOutReply('Stop emailing me.')).toBe(true)
    expect(isOptOutReply('STOP')).toBe(true)
  })
  it('holds bodyless or oversized content rather than inventing or truncating a reply',()=>{
    expect(()=>normalizeReceivedContent(fixture)).toThrow()
    expect(()=>normalizeReceivedContent({...fixture,text:'x'.repeat(100001)})).toThrow()
  })
})
