import { describe,expect,it } from 'vitest'
import { decryptEmailSecret,encryptEmailSecret,maskSecret } from '../secrets'
describe('email secrets',()=>{
 it('uses AAD-bound AES-GCM and only displays masked values',()=>{const key=Buffer.alloc(32,7), encrypted=encryptEmailSecret('re_very_secret_token',key,'workspace:connection',1); expect(decryptEmailSecret(encrypted,key,'workspace:connection')).toBe('re_very_secret_token'); expect(()=>decryptEmailSecret(encrypted,key,'other')).toThrow(); expect(maskSecret('re_very_secret_token')).toBe('re_v••••oken')})
 it('keeps ciphertext readable after a versioned re-encrypt',()=>{
  const v1=Buffer.alloc(32,3), v2=Buffer.alloc(32,4)
  const first=encryptEmailSecret('whsec_fixture',v1,'ws/endpoint/resend-webhook/1',1)
  const plain=decryptEmailSecret(first,v1,'ws/endpoint/resend-webhook/1')
  const rotated=encryptEmailSecret(plain,v2,'ws/endpoint/resend-webhook/2',2)
  expect(rotated.keyVersion).toBe(2)
  expect(decryptEmailSecret(rotated,v2,'ws/endpoint/resend-webhook/2')).toBe('whsec_fixture')
  expect(()=>decryptEmailSecret(rotated,v1,'ws/endpoint/resend-webhook/2')).toThrow()
 })
})
