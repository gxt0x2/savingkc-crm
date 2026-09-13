import {describe,it,expect,vi} from 'vitest'
import {createReceivingWorkerHttp} from '../inbound/worker-http'
const secret='fixture-worker-bearer-at-least-32-characters'
function fixture(enabled=true) {
  const database=vi.fn(),process=vi.fn().mockResolvedValue({state:'idle'}),ownerId=()=> '11111111-1111-4111-8111-111111111111'
  const run=createReceivingWorkerHttp({database,process,ownerId,enabled:()=>enabled,secret:()=>secret})
  const request=(token=secret)=>new Request('http://localhost/api/workers/email',{headers:{Authorization:`Bearer ${token}`}})
  return {database,process,run,request}
}
describe('receiving-only worker authorization',()=>{
  it('rejects missing or wrong bearer before touching the database',async()=>{const f=fixture();expect((await f.run(f.request('wrong'))).status).toBe(401);expect(f.database).not.toHaveBeenCalled()})
  it('does not process when disabled',async()=>{const f=fixture(false);expect(await (await f.run(f.request())).json()).toEqual({state:'disabled',processed:0});expect(f.process).not.toHaveBeenCalled()})
  it('runs only as the server configured owner',async()=>{const f=fixture();expect((await f.run(f.request())).status).toBe(200);expect(f.process).toHaveBeenCalledOnce();expect(f.process.mock.calls[0][1]).toBe('11111111-1111-4111-8111-111111111111')})
})
