import { describe, it, expect, vi } from 'vitest'
import { createHostedSetupHttp } from '../setup/http'
describe('hosted setup HTTP authority',()=>{
 it('rejects unsigned setup reads before database access',async()=>{
  const database=vi.fn(),subject=vi.fn().mockResolvedValue(null)
  expect((await createHostedSetupHttp({database,subject}).GET(new Request('https://crm.example.test/api/email/setup'))).status).toBe(401)
  expect(database).not.toHaveBeenCalled()
 })
 it('rejects cross-origin actions before database or provider access',async()=>{
  const database=vi.fn(),subject=vi.fn().mockResolvedValue('owner')
  const request=new Request('https://crm.example.test/api/email/setup',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({action:'process_replies'})})
  expect((await createHostedSetupHttp({database,subject}).POST(request)).status).toBe(403)
  expect(database).not.toHaveBeenCalled()
 })
 it('cannot override the controlled recipient in a request',async()=>{
  const database=vi.fn(),subject=vi.fn().mockResolvedValue('owner')
  const request=new Request('https://crm.example.test/api/email/setup',{method:'POST',headers:{origin:'https://crm.example.test','content-type':'application/json'},body:JSON.stringify({action:'send_test',senderId:'00000000-0000-4000-8000-000000000001',idempotencyKey:'00000000-0000-4000-8000-000000000002',recipient:'someone@example.test'})})
  expect((await createHostedSetupHttp({database,subject}).POST(request)).status).toBe(400)
  expect(database).not.toHaveBeenCalled()
 })
})
