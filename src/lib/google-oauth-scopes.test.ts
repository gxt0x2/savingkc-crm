import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CALENDAR_SCOPE,
  GMAIL_MODIFY_SCOPE,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  REQUIRED_GOOGLE_OAUTH_SCOPES,
  USERINFO_EMAIL_SCOPE,
  USERINFO_PROFILE_SCOPE,
  hasGoogleScope,
  missingGoogleScopes,
} from '@/lib/google-oauth-scopes'

describe('Google OAuth scopes', () => {
  it('keeps authorize on the narrowed grant and omits unused gmail.modify', () => {
    const source = readFileSync('src/app/api/auth/google/authorize/route.ts', 'utf8')
    expect(source).toContain('REQUIRED_GOOGLE_OAUTH_SCOPES')
    expect(source).not.toContain(GMAIL_MODIFY_SCOPE)
    expect(REQUIRED_GOOGLE_OAUTH_SCOPES).toEqual([
      GMAIL_READONLY_SCOPE,
      GMAIL_SEND_SCOPE,
      CALENDAR_SCOPE,
      USERINFO_EMAIL_SCOPE,
      USERINFO_PROFILE_SCOPE,
    ])
    expect(REQUIRED_GOOGLE_OAUTH_SCOPES).not.toContain(GMAIL_MODIFY_SCOPE)
  })

  it('recognizes both full URLs and short stored scope names', () => {
    expect(hasGoogleScope('gmail.send calendar', GMAIL_SEND_SCOPE)).toBe(true)
    expect(hasGoogleScope(GMAIL_SEND_SCOPE, 'gmail.send')).toBe(true)
    expect(hasGoogleScope('gmail.readonly', GMAIL_SEND_SCOPE)).toBe(false)
    expect(missingGoogleScopes('gmail.readonly')).toEqual(expect.arrayContaining([
      GMAIL_SEND_SCOPE,
      CALENDAR_SCOPE,
    ]))
    expect(missingGoogleScopes([
      GMAIL_READONLY_SCOPE,
      GMAIL_SEND_SCOPE,
      CALENDAR_SCOPE,
      USERINFO_EMAIL_SCOPE,
      USERINFO_PROFILE_SCOPE,
    ].join(' '))).toEqual([])
    expect(missingGoogleScopes('gmail.readonly gmail.send calendar email profile')).not.toContain(GMAIL_MODIFY_SCOPE)
  })
})
