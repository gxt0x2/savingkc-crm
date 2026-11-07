#!/usr/bin/env node
/**
 * Headed Mojo login helper (temporary).
 * Opens a visible Chrome on the bot profile at the Mojo login page,
 * waits for the user to log in, then captures + validates the sessionid
 * and writes it to the session file. No credentials stored here.
 */
import { chromium } from 'playwright-core'
import fs from 'fs'

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const USER_DATA_DIR = '/Users/ernestdodson/.openclaw/workspace/.ari/mojo-bot/chrome-profile'
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
  executablePath: CHROME_PATH,
  headless: false,
  args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
})
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto(`${MOJO_BASE_URL}/login/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
console.log('BROWSER_OPEN — log into Mojo in the Chrome window now. Polling for up to 8 minutes...')

const deadline = Date.now() + 8 * 60 * 1000
let captured = null

while (Date.now() < deadline) {
  const cookies = await ctx.cookies().catch(() => [])
  const sess = cookies.find(
    (c) => c.name === 'sessionid' && c.domain.includes('mojosells') && c.value && c.value.length >= 20
  )
  if (sess) {
    // Validate against the real API before trusting it
    const r = await ctx.request
      .get(`${MOJO_BASE_URL}/v2/rest/home/activity-stream/?page=1`, {
        headers: { accept: 'application/json', referer: `${MOJO_BASE_URL}/` },
      })
      .catch(() => null)
    if (r && r.status() === 200) {
      captured = sess.value
      console.log(`VALID_SESSION captured (len=${captured.length})`)
      break
    } else {
      console.log(`sessionid present but API returned ${r ? r.status() : 'no-response'} — waiting for full login...`)
    }
  }
  await sleep(3000)
}

if (captured) {
  fs.writeFileSync(
    SESSION_FILE,
    JSON.stringify({ sessionId: captured, updatedAt: new Date().toISOString(), expired: false }, null, 2)
  )
  console.log(`SUCCESS — session written to ${SESSION_FILE}`)
  await ctx.close().catch(() => {})
  process.exit(0)
} else {
  console.log('TIMEOUT — no valid Mojo session captured within 8 minutes')
  await ctx.close().catch(() => {})
  process.exit(2)
}
