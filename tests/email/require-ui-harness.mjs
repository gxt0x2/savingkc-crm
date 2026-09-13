import process from 'node:process'

const required = ['EMAIL_UI_BASE_URL', 'EMAIL_UI_TEST_ACTOR', 'EMAIL_UI_AUTH_BYPASS_SECRET']
const missing = required.filter((key) => !process.env[key]?.trim())
if (missing.length > 0) {
  console.error('Email browser harness not run: missing ' + missing.join(', ') + '. It requires an authenticated non-production test target and never starts the app with placeholder credentials.')
  process.exit(2)
}
let target
try {
  target = new URL(process.env.EMAIL_UI_BASE_URL)
} catch {
  console.error('Email browser harness not run: EMAIL_UI_BASE_URL must be a valid URL.')
  process.exit(2)
}
if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
  console.error('Email browser harness not run: the target must use HTTPS or a local test host.')
  process.exit(2)
}
