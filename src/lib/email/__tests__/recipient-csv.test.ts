import { describe,it,expect } from 'vitest'
import { parseRecipientCsv } from '@/components/email/recipient-csv'
describe('recipient CSV',()=>{
 it('parses quoted commas and preserves verification evidence',()=>{
  expect(parseRecipientCsv('name,email,verification_status,verified_at,verification_source\n"Dodson, Ernest",ernest@example.test,valid,2026-09-13T12:00:00Z,report-1')[0]).toEqual({name:'Dodson, Ernest',email:'ernest@example.test',verificationStatus:'valid',verifiedAt:'2026-09-13T12:00:00Z',verificationSource:'report-1'})
 })
 it('does not claim syntactically valid addresses are verified',()=>{
  expect(parseRecipientCsv('name,email\nErnest,ernest@example.test')[0].verificationStatus).toBe('unknown')
 })
 it('rejects truncated columns and unterminated quoting',()=>{
  expect(()=>parseRecipientCsv('name,email\nErnest')).toThrow()
  expect(()=>parseRecipientCsv('name,email\n"Ernest,ernest@example.test')).toThrow()
 })
})
