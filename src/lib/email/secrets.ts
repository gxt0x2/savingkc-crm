import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
export interface EncryptedSecret { keyVersion: number; ciphertext: string; nonce: string; authTag: string }
export function encryptEmailSecret(value: string, key: Buffer, aad: string, keyVersion: number): EncryptedSecret {
 if (key.length !== 32 || !value) throw new Error('INVALID_SECRET_INPUT')
 const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,nonce); cipher.setAAD(Buffer.from(aad)); const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return {keyVersion,ciphertext:ciphertext.toString('base64'),nonce:nonce.toString('base64'),authTag:cipher.getAuthTag().toString('base64')}
}
export function decryptEmailSecret(secret: EncryptedSecret, key: Buffer, aad: string): string { const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(secret.nonce,'base64')); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(secret.authTag,'base64')); return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext,'base64')),decipher.final()]).toString('utf8') }
export function maskSecret(value: string) { return value.length < 8 ? '••••' : `${value.slice(0,4)}••••${value.slice(-4)}` }
