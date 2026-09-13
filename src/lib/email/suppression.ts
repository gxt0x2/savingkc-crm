import { createHash, randomBytes } from 'node:crypto'
export function createPreferenceToken() { return randomBytes(32).toString('base64url') }
export function hashPreferenceToken(token: string, key: string) { return createHash('sha256').update(`${key}:${token}`).digest('hex') }
export type Suppression = { scope:'all_marketing'|'program'|'campaign'; program?:string; releasedAt?:Date|null }
export function isSuppressed(items: Suppression[], program: string) { return items.some(item => !item.releasedAt && (item.scope === 'all_marketing' || (item.scope === 'program' && item.program === program))) }
export function publicUnsubscribeResult() { return { ok: true, message: 'Your preferences have been updated.' } }
