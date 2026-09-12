// Guard against the recurring "outbound dialer is silent" regression.
//
// Four pieces have to stay in lockstep:
//   1. The TwiML must include answerOnBridge="true" on the outbound Dial.
//   2. TwiML must request a deterministic US ring tone.
//   3. The Voice SDK client must enable the ringing event.
//   4. The client must play local ringback when Twilio reports no early media.
//
// If any piece disappears, the agent can hear silence then a disconnect tone
// — the exact symptom Casey reported (it's already happened three times).
//
// This script fails the CI gate if either invariant is missing, so we can't
// silently regress a 4th time.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const checks = [
  {
    file: 'src/app/api/twiml-voice/route.ts',
    needle: 'answerOnBridge="true"',
    why: 'TwiML must use answerOnBridge="true" so the parent leg ringback fires until the callee answers.',
  },
  {
    file: 'src/components/telephony/telephony-bar.tsx',
    needle: 'enableRingingState: true',
    why: 'Twilio Voice SDK connect() must pass enableRingingState: true so the client receives ringing state.',
  },
  {
    file: 'src/app/api/twiml-voice/route.ts',
    needle: 'ringTone="us"',
    why: 'Outbound TwiML must request deterministic US ringback instead of relying only on carrier early media.',
  },
  {
    file: 'src/components/telephony/use-dialer-ringback.ts',
    needle: "new Audio('/api/audio/us-ringback.wav')",
    why: 'The browser must play local ringback when the ringing event reports no early media.',
  },
  {
    file: 'src/components/telephony/telephony-bar.tsx',
    needle: 'if (deviceInitPromiseRef.current) return deviceInitPromiseRef.current',
    why: 'Dialer initialization must be single-flight so one agent identity cannot register competing Voice devices.',
  },
  {
    file: 'src/components/telephony/telephony-bar.tsx',
    needle: 'await prepareCallMicrophone(deviceRef.current)',
    why: 'The dialer must bind and verify the actual Twilio input stream before it can place a call.',
  },
]

let failed = false
for (const check of checks) {
  const path = join(root, check.file)
  let body
  try {
    body = readFileSync(path, 'utf8')
  } catch (err) {
    console.error(`✗ dialer ringback check: cannot read ${check.file} (${err.message})`)
    failed = true
    continue
  }
  if (!body.includes(check.needle)) {
    console.error(`✗ dialer ringback check: \`${check.needle}\` missing from ${check.file}`)
    console.error(`  why this matters: ${check.why}`)
    failed = true
  } else {
    console.log(`✓ ${check.file} contains \`${check.needle}\``)
  }
}

if (failed) {
  console.error('\nDialer ringback gate failed. See PR #157 for context and history.')
  process.exit(1)
}
console.log('Dialer ringback gate passed.')
