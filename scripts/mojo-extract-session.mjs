#!/usr/bin/env node
/**
 * Mojo Session Extractor
 *
 * Captures a valid Mojo sessionid cookie from either:
 * 1. An existing Chrome CDP session.
 * 2. The dedicated Playwright Chrome profile.
 * 3. A visible manual-login window opened with --manual / --headed.
 *
 * On success, writes the cookie to disk and stores it in CRM system_config via
 * /api/admin/mojo-session.
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import {
  clearMojoSessionIssue,
  ensureParentDir,
  loadMojoEnv,
  mojoSessionFile,
  pushSessionToCrm,
  recordMojoSessionIssue,
} from './mojo-session-health.mjs'

loadMojoEnv()

const CDP_URL = process.env.MOJO_CDP_URL || 'http://127.0.0.1:18800'
const MOJO_BASE_URL = process.env.MOJO_BASE_URL || 'https://app71.mojosells.com'
const MOJO_LOGIN_URL = process.env.MOJO_LOGIN_URL || 'https://lb11.mojosells.com/login/'
const MOJO_LOGIN_ORIGIN = new URL(MOJO_LOGIN_URL).origin
const USER_DATA_DIR =
  process.env.MOJO_CHROME_PROFILE ||
  '/Users/ernestdodson/.openclaw/workspace/.ari/mojo-bot/chrome-profile'
const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SESSION_FILE = mojoSessionFile()

function cleanCredential(value) {
  return (value || '').replace(/\\[rnt]/g, '').trim()
}

const EMAIL = cleanCredential(process.env.MOJO_EMAIL || 'savingkc@gmail.com')
const PASSWORD = cleanCredential(process.env.MOJO_PASSWORD || '')
const DATABASE_VALUE = cleanCredential(process.env.MOJO_DATABASE || '')
const MANUAL_MODE = process.argv.includes('--manual') || process.argv.includes('--headed')
const HEADLESS = !MANUAL_MODE && process.env.MOJO_HEADLESS !== 'false'
const MANUAL_TIMEOUT_MS = Number(process.env.MOJO_MANUAL_TIMEOUT_MS || 10 * 60 * 1000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isLoginUrl(url) {
  return /\/login\/?|\/accounts\/login/i.test(url)
}

async function getValidSessionCookie(context) {
  const cookieUrls = [MOJO_BASE_URL, new URL(MOJO_LOGIN_URL).origin]
  const cookies = await context.cookies(cookieUrls).catch(() => [])
  const sessionCookie = cookies.find(
    (cookie) => cookie.name === 'sessionid' && cookie.value && cookie.value.length >= 20,
  )
  if (!sessionCookie) return null

  const res = await context.request.get(`${MOJO_BASE_URL}/v2/rest/home/activity-stream/?page=1`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${MOJO_BASE_URL}/`,
    },
    maxRedirects: 0,
    timeout: 20_000,
  }).catch(() => null)

  if (!res || res.status() < 200 || res.status() >= 300) return null
  const contentType = res.headers()['content-type'] || ''
  if (!contentType.includes('json')) return null

  return sessionCookie
}

async function waitForDatabaseField(page) {
  const deadline = Date.now() + 5_000
  let sawDatabaseField = false

  while (Date.now() < deadline) {
    const result = await page.evaluate((fallbackValue) => {
      const inputs = Array.from(document.querySelectorAll('input'))
      const matches = inputs.filter((input) => {
        const key = `${input.id || ''} ${input.name || ''}`.toLowerCase()
        return key.includes('database') || key.includes('db_name') || key.includes('dbname')
      })

      if (matches.length === 0) {
        return { found: false, populated: false, label: '' }
      }

      const input = matches[0]
      if (!input.value && fallbackValue) {
        input.value = fallbackValue
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }

      return {
        found: true,
        populated: Boolean(input.value),
        label: input.id || input.name || 'database',
      }
    }, DATABASE_VALUE)

    if (!result.found) return null
    sawDatabaseField = true
    if (result.populated) {
      console.log(`Mojo database field populated (${result.label})`)
      return result
    }

    await sleep(250)
  }

  if (sawDatabaseField) {
    throw new Error('Mojo database hidden field did not populate after username blur')
  }

  return null
}

async function fillLoginIdentifier(page) {
  const username = page.locator('#id_username, input[name="username"], input[name="email"], input[type="email"]').first()
  await username.waitFor({ state: 'visible', timeout: 45_000 })
  await username.fill(EMAIL)
  const fieldKind = await username.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    el.blur()
    return `${el.id || ''} ${el.getAttribute('name') || ''}`.toLowerCase()
  })

  if (fieldKind.includes('id_username') || fieldKind.includes('username')) {
    await waitForDatabaseField(page)
  }
}

async function submitLoginForm(page) {
  const clickableSubmit = page.locator('button[type="submit"], input[type="submit"]').first()
  try {
    await clickableSubmit.click({ timeout: 15_000 })
    return
  } catch {
    await page.evaluate(() => {
      const form = document.querySelector('form')
      if (form && 'requestSubmit' in form) {
        form.requestSubmit()
        return
      }
      const submit = document.querySelector('button[type="submit"], input[type="submit"]')
      if (submit instanceof HTMLElement) submit.click()
    })
  }
}

async function waitForValidSession(page, context, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sessionCookie = await getValidSessionCookie(context)
    if (sessionCookie) return sessionCookie

    if (!isLoginUrl(page.url())) {
      await page.goto(`${MOJO_BASE_URL}/stream/`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      }).catch(() => {})
    }

    await sleep(1_500)
  }

  return null
}

async function performAutomatedLogin(page, context) {
  if (!PASSWORD) {
    throw new Error('MOJO_PASSWORD env var is required for automated Mojo login')
  }

  try {
    return await performRestLogin(page, context)
  } catch (err) {
    console.log(`Mojo REST login failed; falling back to browser form (${err instanceof Error ? err.message : String(err)})`)
  }

  console.log('Not logged in; attempting Mojo login...')
  await page.goto(MOJO_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  await fillLoginIdentifier(page)

  const password = page.locator('#id_password, input[name="password"], input[type="password"]').first()
  await password.waitFor({ state: 'visible', timeout: 45_000 })
  await password.fill(PASSWORD)

  await submitLoginForm(page)
  const sessionCookie = await waitForValidSession(page, context)
  if (!sessionCookie) {
    throw new Error(`Login failed - Mojo did not issue a valid session cookie (current URL: ${page.url()})`)
  }

  return sessionCookie
}

async function performRestLogin(page, context) {
  console.log('Not logged in; attempting Mojo REST login...')

  const checkRes = await context.request.post(`${MOJO_LOGIN_ORIGIN}/rest/auth/check_agent_email/`, {
    multipart: { email: EMAIL },
    timeout: 20_000,
  })
  if (!checkRes.ok()) {
    throw new Error(`check_agent_email returned ${checkRes.status()}`)
  }

  const checkJson = await checkRes.json()
  const loginData = Array.isArray(checkJson?.login_data_list) ? checkJson.login_data_list[0] : null
  if (!checkJson?.status || !loginData?.host) {
    throw new Error('check_agent_email did not return an active Mojo account')
  }

  if (loginData.host && !MOJO_BASE_URL.includes(loginData.host)) {
    console.log(`Mojo login account host is ${loginData.host}; API validation remains ${MOJO_BASE_URL}`)
  }
  if (loginData.database) {
    console.log(`Mojo account database resolved (${loginData.database})`)
  }

  const loginRes = await context.request.post(`${MOJO_LOGIN_ORIGIN}/rest/auth/login/`, {
    multipart: {
      email: EMAIL,
      password: PASSWORD,
      screenHeight: '720',
      screenWidth: '1280',
      browser: 'Chrome',
      version: '149',
      mobileRetry: 'null',
      isMobile: 'false',
    },
    timeout: 20_000,
  })

  const loginText = await loginRes.text()
  let loginJson = null
  try {
    loginJson = JSON.parse(loginText)
  } catch {}

  if (!loginRes.ok()) {
    const errorMessage = loginJson?.errors || loginText.slice(0, 160)
    throw new Error(`Mojo REST login returned ${loginRes.status()}: ${errorMessage}`)
  }

  const redirectUrl = loginJson?.redirect_url
  if (!redirectUrl) {
    throw new Error('Mojo REST login did not return redirect_url')
  }

  await page.goto(redirectUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await page.waitForTimeout(2_000)

  const sessionCookie = await waitForValidSession(page, context, 20_000)
  if (!sessionCookie) {
    throw new Error('Mojo REST login redirect did not create a valid app session')
  }

  return sessionCookie
}

async function waitForManualLogin(page, context) {
  await page.goto(MOJO_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(() => {})

  console.log('Manual mode: log into Mojo in the Chrome window now. Waiting for a valid session...')
  const deadline = Date.now() + MANUAL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const sessionCookie = await getValidSessionCookie(context)
    if (sessionCookie) return sessionCookie
    await sleep(3_000)
  }

  throw new Error('Manual login timed out before a valid Mojo session was captured')
}

async function saveSession(sessionId) {
  const session = {
    sessionId,
    updatedAt: new Date().toISOString(),
    expired: false,
  }

  ensureParentDir(SESSION_FILE)
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2))
  console.log(`Session saved to ${SESSION_FILE}`)
  console.log(`Session ID: ${session.sessionId.substring(0, 20)}...`)

  const pushed = await pushSessionToCrm(sessionId)
  if (pushed) {
    console.log('Session stored in CRM system_config (key: mojo_session_id)')
  }

  await clearMojoSessionIssue('mojo-extract-session')
}

async function connectContext() {
  let browser = null
  let context = null
  let usedCDP = false

  if (!MANUAL_MODE) {
    console.log(`Attempting to connect via CDP (${CDP_URL})...`)
    try {
      browser = await chromium.connectOverCDP(CDP_URL)
      const contexts = browser.contexts()
      if (contexts.length > 0) {
        context = contexts[0]
        usedCDP = true
        console.log('Connected via CDP')
      }
    } catch {
      console.log('CDP connection failed, launching dedicated Chrome profile...')
    }
  }

  if (!context) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true })
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      executablePath: CHROME_PATH,
      headless: HEADLESS,
      args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
    })
    console.log(`Launched dedicated Chrome profile (${HEADLESS ? 'headless' : 'headed'})`)
  }

  return { browser, context, usedCDP }
}

async function extractSession() {
  let browser = null
  let context = null
  let usedCDP = false

  try {
    ;({ browser, context, usedCDP } = await connectContext())

    const page = await context.newPage()

    const existing = await getValidSessionCookie(context)
    if (existing) {
      console.log('Already logged in; captured existing Mojo session')
      await saveSession(existing.value)
      return { ok: true, sessionId: existing.value }
    }

    let sessionCookie
    if (MANUAL_MODE) {
      sessionCookie = await waitForManualLogin(page, context)
    } else {
      await page.goto(`${MOJO_BASE_URL}/stream/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      }).catch(() => {})

      if (!isLoginUrl(page.url())) {
        const afterStreamLoad = await getValidSessionCookie(context)
        if (afterStreamLoad) {
          sessionCookie = afterStreamLoad
        }
      }

      if (!sessionCookie) {
        sessionCookie = await performAutomatedLogin(page, context)
      }
    }

    await saveSession(sessionCookie.value)
    return { ok: true, sessionId: sessionCookie.value }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Session extraction failed:', message)
    await recordMojoSessionIssue({
      source: 'mojo-extract-session',
      reason: 'session_refresh_failed',
      message: `Mojo session expired - manual refresh required (${message})`,
    })
    return { ok: false, error: message }
  } finally {
    try {
      if (context && !usedCDP) await context.close()
    } catch {}
    try {
      if (browser) await browser.close()
    } catch {}
  }
}

extractSession()
  .then((result) => {
    if (result.ok) {
      console.log('Session extraction completed successfully')
      process.exit(0)
    }

    console.error('Session extraction failed:', result.error)
    const scriptPath = process.argv[1]
      ? path.relative(process.cwd(), process.argv[1])
      : 'scripts/mojo-extract-session.mjs'
    console.error(`For manual refresh, run: node ${scriptPath} --manual`)
    process.exit(1)
  })
  .catch((err) => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
