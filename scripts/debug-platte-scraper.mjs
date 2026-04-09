#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  console.log('=== Debug Platte County Scraper Logic ===\n')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()

  const address = '7017 NW WINTER AVE'
  const streetOnly = address.split(',')[0].trim()
  const searchQuery = streetOnly
    .replace(/\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Ter|Way|Cir|Pkwy|STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|TERRACE|TRAIL|CIRCLE|PARKWAY)\.?\s*$/i, '')
    .trim()

  console.log(`Address: "${address}"`)
  console.log(`Search query: "${searchQuery}"`)

  // Navigate to search
  console.log('\n1. Loading search page...')
  await page.goto('https://plattecountycollector.com/realsearch.php', {
    waitUntil: 'domcontentloaded', timeout: 30000
  })
  await page.waitForTimeout(1000)
  console.log('  ✓ Search page loaded')

  // Fill and submit
  console.log(`2. Filling strtname with "${searchQuery}"...`)
  await page.locator('input[name="strtname"]').fill(searchQuery)

  const submitBtns = page.locator('input[type="submit"]')
  const btnCount = await submitBtns.count()
  console.log(`  Found ${btnCount} submit buttons`)

  if (btnCount >= 3) {
    console.log('  Clicking 3rd submit button...')
    await submitBtns.nth(2).click()
  } else {
    console.log('  Pressing Enter...')
    await page.locator('input[name="strtname"]').press('Enter')
  }
  await page.waitForTimeout(3000)

  console.log('  Current URL:', page.url())
  await page.screenshot({ path: '/tmp/platte-debug-results.png' })

  // Check results
  const bodyText = await page.evaluate(() => document.body.innerText)
  const recordMatch = bodyText.match(/Number of Records Found: (\d+)/)
  console.log(`  Records found: ${recordMatch ? recordMatch[1] : 'unknown'}`)

  if (recordMatch && parseInt(recordMatch[1]) > 0) {
    // Extract parcel from table
    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'))
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'))
        if (cells.length >= 5) {
          const parcel = cells[1]?.innerText?.trim() || ''
          const physical = cells[4]?.innerText?.trim() || ''
          if (parcel.match(/^\d+-/)) {
            return { parcelId: parcel, address: physical, owner: cells[2]?.innerText?.trim() }
          }
        }
      }
      return null
    })
    console.log('  Result:', JSON.stringify(result))

    if (result?.parcelId) {
      // Test collector detail
      console.log(`\n3. Loading collector detail for ${result.parcelId}...`)
      await page.goto(
        `https://plattecountycollector.com/realview.php?user=beacon&pid=${encodeURIComponent(result.parcelId)}`,
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      )
      await page.waitForTimeout(2000)

      const detailText = await page.evaluate(() => document.body.innerText)
      console.log('  Detail preview:', detailText.substring(0, 500))

      // Test Beacon - try both with and without new context
      for (const useContext of [false, true]) {
        console.log(`\n4. Loading Beacon (newContext=${useContext}) for ${result.parcelId}...`)
        let beaconPage
        if (useContext) {
          const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
          beaconPage = await ctx.newPage()
        } else {
          beaconPage = await browser.newPage()
        }

        try {
          await beaconPage.goto(
            `https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&KeyValue=${encodeURIComponent(result.parcelId)}`,
            { waitUntil: 'domcontentloaded', timeout: 30000 }
          )
          await beaconPage.waitForTimeout(5000)

          await beaconPage.screenshot({ path: `/tmp/platte-beacon-ctx${useContext}.png` })

          const beaconText = await beaconPage.evaluate(() => document.body.innerText)
          const hasYearBuilt = beaconText.includes('Year Built')
          const hasSqft = beaconText.includes('Gross Living Area')
          const hasCloudflare = beaconText.includes('Cloudflare') || beaconText.includes('challenge')
          console.log(`  Year Built: ${hasYearBuilt}, Sqft: ${hasSqft}, Cloudflare: ${hasCloudflare}`)
          console.log('  Title:', await beaconPage.title())

          // Try dt/dd extraction
          const dtData = await beaconPage.evaluate(() => {
            const results = {}
            document.querySelectorAll('dt').forEach(dt => {
              const dd = dt.nextElementSibling
              if (dd?.tagName === 'DD') {
                results[dt.textContent?.trim() || ''] = dd.textContent?.trim() || ''
              }
            })
            return results
          })
          console.log('  DT/DD data:', JSON.stringify(dtData))

        } catch (err) {
          console.log(`  Error: ${err.message.substring(0, 100)}`)
        }
        await beaconPage.close()
      }
    }
  } else {
    console.log('  ✗ No results! Page text:')
    console.log(bodyText.substring(0, 500))
  }

  await browser.close()
  console.log('\n✓ Done')
}

main().catch(err => { console.error(err); process.exit(1) })
