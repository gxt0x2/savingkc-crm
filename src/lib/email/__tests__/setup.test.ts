import { describe,expect,it } from 'vitest'
import { decryptEmailSecret,encryptEmailSecret,maskSecret } from '../secrets'
describe('email secrets',()=>{it('uses AAD-bound AES-GCM and only displays masked values',()=>{const key=Buffer.alloc(32,7), encrypted=encryptEmailSecret('re_very_secret_token',key,'workspace:connection',1); expect(decryptEmailSecret(encrypted,key,'workspace:connection')).toBe('re_very_secret_token'); expect(()=>decryptEmailSecret(encrypted,key,'other')).toThrow(); expect(maskSecret('re_very_secret_token')).toBe('re_v••••oken')})})
