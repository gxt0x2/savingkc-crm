#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  console.log('=== Exploring Platte County Property Sites ===\n')

  const browser = await chromium.launch({ headless: true, timeout: 30000 })
  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  })

  // Site 1: Beacon (Schneider Corp) — Assessor data
  console.log('=== SITE 1: Beacon (Schneider Corp) — Assessor ===\n')
  try {
    await page.goto(
      'https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&Q=2120193227&KeyValue=20-6.0-24-100-007-011.000',
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    )
    await page.waitForTimeout(3000)

    await page.screenshot({ path: '/tmp/platte-beacon.png', fullPage: true })
    console.log('Screenshot: /tmp/platte-beacon.png')

    const title = await page.title()
    console.log('Title:', title)
    console.log('URL:', page.url())

    // Check for disclaimer/accept button
    const acceptBtn = page.locator('button:has-text("Accept"), a:has-text("Accept"), input[value*="Accept"], #ctlBodyPane_ctl00_btnDisclaimerAccept')
    if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Found accept button, clicking...')
      await acceptBtn.first().click()
      await page.waitForTimeout(3000)
      await page.screenshot({ path: '/tmp/platte-beacon-after-accept.png', fullPage: true })
      console.log('Screenshot after accept: /tmp/platte-beacon-after-accept.png')
    }

    const bodyText = await page.evaluate(() => document.body.innerText)
    console.log('\n--- PAGE TEXT (first 3000 chars) ---')
    console.log(bodyText.substring(0, 3000))

    // Find all tables and data sections
    const tables = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table')).map(t => ({
        id: t.id,
        class: t.className,
        rows: t.rows.length,
        text: t.innerText.substring(0, 300)
      })).filter(t => t.rows > 1)
    })
    console.log('\n--- TABLES ---')
    tables.forEach(t => console.log(`Table(id=${t.id}, class=${t.class}, rows=${t.rows}): ${t.text.substring(0, 150)}`))

    // Find labeled data (dt/dd, label/value pairs)
    const dataFields = await page.evaluate(() => {
      const fields = []
      // Check for dt/dd pairs
      document.querySelectorAll('dt').forEach(dt => {
        const dd = dt.nextElementSibling
        if (dd && dd.tagName === 'DD') {
          fields.push({ label: dt.innerText.trim(), value: dd.innerText.trim() })
        }
      })
      // Check for label + span pairs
      document.querySelectorAll('.field-label, .label, th').forEach(el => {
        const next = el.nextElementSibling
        if (next) {
          fields.push({ label: el.innerText.trim(), value: next.innerText.trim().substring(0, 100) })
        }
      })
      return fields.slice(0, 50)
    })
    console.log('\n--- DATA FIELDS ---')
    dataFields.forEach(f => console.log(`  ${f.label}: ${f.value}`))

  } catch (err) {
    console.error('Beacon error:', err.message)
  }

  // Site 2: Platte County Collector — Tax data
  console.log('\n\n=== SITE 2: Platte County Collector — Tax ===\n')
  try {
    // Skip SSL verification for this site
    const page2 = await browser.newPage({ ignoreHTTPSErrors: true })
    await page2.goto(
      'https://plattecountycollector.com/realview.php?user=beacon&pid=20-6.0-24-100-007-011.000',
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    )
    await page2.waitForTimeout(3000)

    await page2.screenshot({ path: '/tmp/platte-collector.png', fullPage: true })
    console.log('Screenshot: /tmp/platte-collector.png')

    const title2 = await page2.title()
    console.log('Title:', title2)
    console.log('URL:', page2.url())

    const bodyText2 = await page2.evaluate(() => document.body.innerText)
    console.log('\n--- PAGE TEXT (first 3000 chars) ---')
    console.log(bodyText2.substring(0, 3000))

    // Tables
    const tables2 = await page2.evaluate(() => {
      return Array.from(document.querySelectorAll('table')).map(t => ({
        id: t.id,
        class: t.className,
        rows: t.rows.length,
        text: t.innerText.substring(0, 500)
      })).filter(t => t.rows > 1)
    })
    console.log('\n--- TABLES ---')
    tables2.forEach(t => console.log(`Table(id=${t.id}, rows=${t.rows}):\n${t.text}\n`))

    await page2.close()
  } catch (err) {
    console.error('Collector error:', err.message)
  }

  // Site 3: Try Beacon search to understand URL patterns
  console.log('\n\n=== SITE 3: Beacon Search Page ===\n')
  try {
    await page.goto(
      'https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=2&PageID=7912',
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    )
    await page.waitForTimeout(2000)

    await page.screenshot({ path: '/tmp/platte-beacon-search.png' })
    console.log('Screenshot: /tmp/platte-beacon-search.png')

    // Find search form fields
    const searchFields = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], select'))
      return inputs.map(el => ({
        id: el.id,
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder') || '',
        class: el.className
      }))
    })
    console.log('Search fields:', JSON.stringify(searchFields, null, 2))

  } catch (err) {
    console.error('Search error:', err.message)
  }

  await browser.close()
  console.log('\n✓ Exploration complete')
}

main().catch(err => { console.error(err); process.exit(1) })
