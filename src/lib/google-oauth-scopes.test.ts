import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CALENDAR_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  USERINFO_EMAIL_SCOPE,
  USERINFO_PROFILE_SCOPE,
  hasGoogleScope,
  missingGoogleScopes,
} from '@/lib/google-oauth-scopes'

describe('Google OAuth scopes', () => {
  it('keeps the authorize route on the full grant', () => {
    const source = readFileSync('src/app/api/auth/google/authorize/route.ts', 'utf8')
    for (const scope of [
      GMAIL_READONLY_SCOPE,
      GMAIL_SEND_SCOPE,
      GMAIL_MODIFY_SCOPE,
      CALENDAR_SCOPE,
      USERINFO_EMAIL_SCOPE,
      USERINFO_PROFILE_SCOPE,
    ]) {
      expect(source).toContain(`'${scope}'`)
    }
  })

  it('recognizes both full URLs and short stored scope names', () => {
    expect(hasGoogleScope('gmail.send calendar', GMAIL_SEND_SCOPE)).toBe(true)
    expect(hasGoogleScope(GMAIL_SEND_SCOPE, 'gmail.send')).toBe(true)
    expect(hasGoogleScope('gmail.readonly', GMAIL_SEND_SCOPE)).toBe(false)
    expect(missingGoogleScopes('gmail.readonly')).toEqual(expect.arrayContaining([
      GMAIL_SEND_SCOPE,
      CALENDAR_SCOPE,
    ]))
  })
})
