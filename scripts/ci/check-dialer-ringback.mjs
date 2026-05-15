// Guard against the recurring "outbound dialer is silent" regression.
//
// Two pieces have to stay in lockstep:
//   1. The TwiML must include answerOnBridge="true" on the outbound Dial.
//   2. The Twilio Voice SDK client must pass enableRingingState: true into
//      device.connect(), otherwise the SDK never emits the ringing event or
//      plays ringback audio while the parent leg is in the "ringing" state.
//
// If either piece disappears, the agent hears silence then a disconnect tone
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
    why: 'Twilio Voice SDK connect() must pass enableRingingState: true so the SDK plays ringback while the parent leg is ringing.',
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
