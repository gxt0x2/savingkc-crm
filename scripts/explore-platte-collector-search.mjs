#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()

  // Check collector homepage for search
  console.log('=== Platte County Collector — Finding Search ===\n')

  await page.goto('https://plattecountycollector.com/', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(2000)

  await page.screenshot({ path: '/tmp/platte-collector-home.png' })
  console.log('Screenshot: /tmp/platte-collector-home.png')

  const bodyText = await page.evaluate(() => document.body.innerText)
  console.log('Homepage text (first 1000):\n', bodyText.substring(0, 1000))

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(l => l.text.length > 0)
  )
  console.log('\nLinks:', JSON.stringify(links, null, 2))

  const forms = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select')).map(el => ({
      tag: el.tagName, type: el.getAttribute('type'), id: el.id, name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder') || ''
    }))
  )
  console.log('\nForm fields:', JSON.stringify(forms, null, 2))

  // Try common search pages
  const searchPages = [
    'https://plattecountycollector.com/search.php',
    'https://plattecountycollector.com/realsearch.php',
    'https://plattecountycollector.com/real.php',
    'https://plattecountycollector.com/index.php',
  ]

  for (const url of searchPages) {
    console.log(`\nTrying: ${url}`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
      const text = await page.evaluate(() => document.body.innerText)
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="text"], select')).map(el => ({
          id: el.id, name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder') || ''
        }))
      )
      console.log(`  Status: OK`)
      console.log(`  Inputs: ${JSON.stringify(inputs)}`)
      console.log(`  Text preview: ${text.substring(0, 200)}`)

      if (inputs.length > 0) {
        await page.screenshot({ path: `/tmp/platte-collector-${url.split('/').pop()}.png` })
      }
    } catch (err) {
      console.log(`  Error: ${err.message.substring(0, 80)}`)
    }
  }

  // Try searching on the realsearch page if it exists
  console.log('\n=== Trying address search ===')
  try {
    await page.goto('https://plattecountycollector.com/realsearch.php', { waitUntil: 'domcontentloaded', timeout: 10000 })
    await page.waitForTimeout(1000)

    const allInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, select')).map(el => ({
        tag: el.tagName, type: el.getAttribute('type'), id: el.id,
        name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder') || '',
        options: el.tagName === 'SELECT' ? Array.from(el.querySelectorAll('option')).map(o => o.value + ':' + o.textContent).slice(0, 5) : []
      }))
    )
    console.log('All form elements:', JSON.stringify(allInputs, null, 2))

    // Try filling address search if available
    const addressField = page.locator('input[name*="address" i], input[name*="street" i], input[name*="situs" i], input[name*="prop" i]').first()
    if (await addressField.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Found address field!')
      await addressField.fill('7017 NW WINTER')

      const submitBtn = page.locator('input[type="submit"], button[type="submit"]').first()
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click()
        await page.waitForTimeout(3000)

        const resultText = await page.evaluate(() => document.body.innerText)
        console.log('Search results:', resultText.substring(0, 1000))
        await page.screenshot({ path: '/tmp/platte-collector-results.png' })
      }
    }
  } catch (err) {
    console.log('Search error:', err.message.substring(0, 100))
  }

  await browser.close()
  console.log('\n✓ Done')
}

main().catch(err => { console.error(err); process.exit(1) })
