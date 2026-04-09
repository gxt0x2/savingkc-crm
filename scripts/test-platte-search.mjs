#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()

  // Step 1: Search collector by street name
  console.log('=== Step 1: Search Collector by Street ===\n')

  await page.goto('https://plattecountycollector.com/realsearch.php', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(1000)

  // Try multiple search approaches
  const searches = ['WINTER', 'NW WINTER', 'WINTER AVE', '7017 NW WINTER']

  for (const term of searches) {
    await page.goto('https://plattecountycollector.com/realsearch.php', { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(500)

    await page.locator('input[name="strtname"]').fill(term)
    // Click the submit button closest to the street name field
    const submitBtns = page.locator('input[type="submit"]')
    const count = await submitBtns.count()
    // The strtname submit is the 3rd submit button (after parcel and name)
    if (count >= 3) {
      await submitBtns.nth(2).click()
    } else {
      await page.locator('input[name="strtname"]').press('Enter')
    }
    await page.waitForTimeout(3000)

    const text = await page.evaluate(() => document.body.innerText)
    const recordMatch = text.match(/Number of Records Found: (\d+)/)
    const records = recordMatch ? recordMatch[1] : '?'
    console.log(`  "${term}" → ${records} records`)

    if (parseInt(records) > 0) {
      await page.screenshot({ path: '/tmp/platte-street-results.png' })
      break
    }
  }


  await page.screenshot({ path: '/tmp/platte-street-results.png' })

  const resultText = await page.evaluate(() => document.body.innerText)
  console.log('Street search results:\n', resultText.substring(0, 2000))

  // Find result links
  const resultLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).filter(a =>
      a.href.includes('realview') || a.href.includes('view')
    ).map(a => ({ text: a.innerText.trim().substring(0, 80), href: a.href }))
  )
  console.log('\nResult links:', JSON.stringify(resultLinks, null, 2))

  // Find parcel IDs in the results
  const tableData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'))
    return rows.map(r => {
      const cells = Array.from(r.querySelectorAll('td, th'))
      return cells.map(c => c.innerText.trim()).join(' | ')
    }).filter(r => r.length > 5)
  })
  console.log('\nTable rows:')
  tableData.forEach(r => console.log(`  ${r}`))

  // Step 2: Click first result to get detail page
  if (resultLinks.length > 0) {
    console.log('\n=== Step 2: Click first result ===\n')
    await page.goto(resultLinks[0].href, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000)

    await page.screenshot({ path: '/tmp/platte-detail.png' })

    const detailText = await page.evaluate(() => document.body.innerText)
    console.log('Detail page:\n', detailText.substring(0, 1500))

    // Extract parcel ID from detail page
    const parcelId = await page.evaluate(() => {
      const text = document.body.innerText
      const match = text.match(/PARCEL ID\s+([\d\-.]+)/)
      return match ? match[1] : null
    })
    console.log('\nExtracted parcel ID:', parcelId)

    // Step 3: Use parcel ID to hit Beacon
    if (parcelId) {
      console.log('\n=== Step 3: Beacon lookup with parcel ID ===\n')
      const beaconPage = await context.newPage()

      // Build Beacon URL
      const beaconUrl = `https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&KeyValue=${encodeURIComponent(parcelId)}`
      console.log('Beacon URL:', beaconUrl)

      await beaconPage.goto(beaconUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await beaconPage.waitForTimeout(5000)

      await beaconPage.screenshot({ path: '/tmp/platte-beacon-cascade.png' })

      const beaconText = await beaconPage.evaluate(() => document.body.innerText)
      console.log('Beacon data:\n', beaconText.substring(0, 2000))

      await beaconPage.close()
    }
  }

  await browser.close()
  console.log('\n✓ Done')
}

main().catch(err => { console.error(err); process.exit(1) })
