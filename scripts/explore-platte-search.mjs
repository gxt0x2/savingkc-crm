#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // Try the Beacon search page with longer wait for JS rendering
  console.log('=== Beacon Search Page (with JS wait) ===\n')

  await page.goto(
    'https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=2&PageID=7912',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  )
  await page.waitForTimeout(5000)

  await page.screenshot({ path: '/tmp/platte-search-loaded.png', fullPage: true })

  // Dump all inputs, selects, textareas
  const formElements = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('input, select, textarea, button'))
    return els.map(el => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      id: el.id,
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder') || '',
      value: el.value || '',
      class: el.className.substring(0, 80),
      visible: el.offsetParent !== null
    })).filter(e => e.visible || e.type === 'hidden')
  })
  console.log('Form elements:', JSON.stringify(formElements, null, 2))

  // Check iframes
  const frames = page.frames()
  console.log(`\nFrames: ${frames.length}`)
  for (const frame of frames) {
    console.log(`  Frame: ${frame.url().substring(0, 100)}`)
  }

  // Try direct Beacon search API
  console.log('\n=== Trying Beacon API search ===')

  // Try common Beacon search patterns
  const searchUrls = [
    'https://beacon.schneidercorp.com/api/search?AppID=589&term=7017+NW+WINTER',
    'https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=3&PageID=7913&term=7017+NW+WINTER',
  ]

  for (const url of searchUrls) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
      const text = await page.evaluate(() => document.body.innerText)
      console.log(`\n${url.substring(0, 60)}...`)
      console.log(`  Status: ${res?.status()}`)
      console.log(`  Response: ${text.substring(0, 300)}`)
    } catch (err) {
      console.log(`  Error: ${err.message}`)
    }
  }

  // Try the global search that appears on the page
  console.log('\n=== Testing Global Search ===')
  await page.goto(
    'https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&Q=2120193227&KeyValue=20-6.0-24-100-007-011.000',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  )
  await page.waitForTimeout(3000)

  // Look for search input on the property page
  const searchInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(el => ({
      id: el.id,
      name: el.getAttribute('name'),
      type: el.type,
      placeholder: el.placeholder,
      class: el.className
    }))
  })
  console.log('Search inputs on property page:', JSON.stringify(searchInputs.filter(s =>
    s.placeholder?.toLowerCase().includes('search') ||
    s.id?.toLowerCase().includes('search') ||
    s.name?.toLowerCase().includes('search')
  ), null, 2))

  // Monitor network requests while searching
  console.log('\n=== Intercepting search requests ===')
  const requests = []
  page.on('request', req => {
    if (req.url().includes('search') || req.url().includes('Search') || req.url().includes('query')) {
      requests.push({ method: req.method(), url: req.url().substring(0, 150) })
    }
  })

  // Try typing in global search
  const globalSearch = page.locator('#ctlBodyPane_ctl00_txtGlobalSearch, input[placeholder*="earch"], #txtGlobalSearch')
  if (await globalSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Found global search input!')
    await globalSearch.fill('7017 NW WINTER')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(5000)

    console.log('Intercepted requests:', JSON.stringify(requests, null, 2))
    console.log('Current URL:', page.url())

    await page.screenshot({ path: '/tmp/platte-search-results.png', fullPage: true })

    const resultText = await page.evaluate(() => document.body.innerText)
    console.log('Results text (first 1000):', resultText.substring(0, 1000))
  } else {
    console.log('No global search found')
  }

  await browser.close()
  console.log('\n✓ Done')
}

main().catch(err => { console.error(err); process.exit(1) })
