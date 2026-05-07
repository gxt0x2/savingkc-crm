#!/usr/bin/env node
/**
 * Mojo Session Extractor
 * Extracts sessionid cookie from Chrome CDP profile or logs in fresh
 */

import { chromium } from 'playwright-core'
import fs from 'fs'

const CDP_URL = 'http://127.0.0.1:18800'
const MOJO_BASE_URL = 'https://app71.mojosells.com'
const USER_DATA_DIR = '/Users/ernestdodson/.openclaw/workspace/.ari/mojo-bot/chrome-profile'
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'

const EMAIL = process.env.MOJO_EMAIL || 'savingkc@gmail.com'
const PASSWORD = process.env.MOJO_PASSWORD || ''

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function extractSession() {
  let browser
  let context
  let usedCDP = false

  try {
    console.log('Attempting to connect via CDP...')
    // Try CDP first
    try {
      browser = await chromium.connectOverCDP(CDP_URL)
      const contexts = browser.contexts()
      if (contexts.length > 0) {
        context = contexts[0]
        usedCDP = true
        console.log('Connected via CDP')
      }
    } catch {
      console.log('CDP connection failed, launching fresh browser...')
    }

    // Fallback to persistent context
    if (!context) {
      context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-first-run', '--no-default-browser-check'],
      })
      console.log('Launched persistent context')
    }

    // Check if already logged in
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(`${MOJO_BASE_URL}/dashboard/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await sleep(2000)

    const url = page.url()
    const isLoggedIn = !url.includes('/login') && !url.includes('/accounts/login')

    if (!isLoggedIn) {
      if (!PASSWORD) {
        throw new Error('MOJO_PASSWORD env var is required for fresh Mojo login')
      }

      console.log('Not logged in, attempting login...')
      await page.goto(`${MOJO_BASE_URL}/login/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      await sleep(1500)

      await page.fill('#id_username', EMAIL)
      await page.fill('#id_password', PASSWORD)
      await page.click('[type="submit"]')
      await sleep(5000)

      const loginUrl = page.url()
      if (loginUrl.includes('/login')) {
        throw new Error('Login failed - still on login page')
      }
      console.log('Login successful')
    } else {
      console.log('Already logged in')
    }

    // Extract cookies
    const cookies = await context.cookies([MOJO_BASE_URL])
    const sessionCookie = cookies.find((c) => c.name === 'sessionid')

    if (!sessionCookie) {
      throw new Error('Session cookie not found')
    }

    // Save session
    const session = {
      sessionId: sessionCookie.value,
      updatedAt: new Date().toISOString(),
      expired: false,
    }

    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2))
    console.log(`Session saved to ${SESSION_FILE}`)
    console.log(`Session ID: ${session.sessionId.substring(0, 20)}...`)

    return { ok: true, sessionId: session.sessionId }
  } catch (err) {
    console.error('Session extraction failed:', err.message)
    return { ok: false, error: err.message }
  } finally {
    try {
      if (context && !usedCDP) await context.close()
    } catch {}
    try {
      if (browser) await browser.close()
    } catch {}
  }
}

// Run extraction
extractSession()
  .then((result) => {
    if (result.ok) {
      console.log('Session extraction completed successfully')
      process.exit(0)
    } else {
      console.error('Session extraction failed:', result.error)
      process.exit(1)
    }
  })
  .catch((err) => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
