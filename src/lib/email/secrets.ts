import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
export interface EncryptedSecret { keyVersion: number; ciphertext: string; nonce: string; authTag: string }
export type CredentialKeyring = Map<number, Buffer>
export function encryptEmailSecret(value: string, key: Buffer, aad: string, keyVersion: number): EncryptedSecret {
 if (key.length !== 32 || !value) throw new Error('INVALID_SECRET_INPUT')
 const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,nonce); cipher.setAAD(Buffer.from(aad)); const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return {keyVersion,ciphertext:ciphertext.toString('base64'),nonce:nonce.toString('base64'),authTag:cipher.getAuthTag().toString('base64')}
}
export function decryptEmailSecret(secret: EncryptedSecret, key: Buffer, aad: string): string { const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(secret.nonce,'base64')); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(secret.authTag,'base64')); return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext,'base64')),decipher.final()]).toString('utf8') }
export function maskSecret(value: string) { return value.length < 8 ? '••••' : `${value.slice(0,4)}••••${value.slice(-4)}` }
export function credentialKeyring(env: NodeJS.ProcessEnv = process.env): CredentialKeyring {
  const keys: CredentialKeyring = new Map()
  for (const [name, value] of Object.entries(env)) {
    const match = /^EMAIL_CREDENTIALS_KEY_V([1-9][0-9]{0,3})$/.exec(name)
    if (match && value && /^[a-f0-9]{64}$/i.test(value))
      keys.set(Number(match[1]), Buffer.from(value, 'hex'))
  }
  return keys
}
export function currentCredentialVersion(keys: CredentialKeyring = credentialKeyring()) {
  return [...keys.keys()].sort((a, b) => b - a)[0] ?? null
}
export function credentialKey(
  version: number,
  keys: CredentialKeyring | Buffer = credentialKeyring(),
): Buffer | null {
  if (Buffer.isBuffer(keys)) return keys
  return keys.get(version) ?? null
}
