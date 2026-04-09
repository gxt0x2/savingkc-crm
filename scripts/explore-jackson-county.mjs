#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  console.log('Exploring Jackson County website structure...\n')

  const browser = await chromium.launch({ headless: true, timeout: 30000 })
  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  })

  // Step 1: Disclaimer page
  console.log('1. Loading disclaimer page...')
  await page.goto(
    'https://publicaccess.jacksongov.org/Search/Disclaimer.aspx?FromUrl=../search/commonsearch.aspx?mode=realprop',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  )
  await page.waitForTimeout(1000)

  await page.screenshot({ path: '/tmp/jc-step1-disclaimer.png' })
  console.log('  Screenshot: /tmp/jc-step1-disclaimer.png')

  // Click agree
  const agreeBtn = page.locator('#btAgree, input[id*="Agree"]').first()
  if (await agreeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('  Found agree button, clicking...')
    await agreeBtn.click()
    await page.waitForTimeout(1000)
  } else {
    console.log('  No agree button found')
  }

  // Step 2: Search page
  console.log('\n2. Loading search page...')
  await page.goto(
    'https://publicaccess.jacksongov.org/search/commonsearch.aspx?mode=realprop',
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  )
  await page.waitForTimeout(1000)

  await page.screenshot({ path: '/tmp/jc-step2-search.png' })
  console.log('  Screenshot: /tmp/jc-step2-search.png')

  // Check for search fields
  const searchFields = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], select'))
    return inputs.map(el => ({ tag: el.tagName, id: el.id, name: el.getAttribute('name'), type: el.getAttribute('type'), class: el.className }))
  })
  console.log('  Search fields:', JSON.stringify(searchFields, null, 2))

  // Step 3: Search for a known address
  console.log('\n3. Searching for "8525 MAYWOOD"...')
  const houseField = page.locator('#inpNo')
  const streetField = page.locator('#inpStreet')

  if (await houseField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await houseField.fill('8525')
    await streetField.fill('MAYWOOD')

    const searchBtn = page.locator('#btSearch')
    await searchBtn.click()
    await page.waitForTimeout(3000)

    await page.screenshot({ path: '/tmp/jc-step3-results.png' })
    console.log('  Screenshot: /tmp/jc-step3-results.png')

    // Dump page URL
    console.log('  Current URL:', page.url())

    // Check for ALL class names on the page
    const allClasses = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'))
      const classSet = new Set()
      elements.forEach(el => {
        el.classList.forEach(c => classSet.add(c))
      })
      return Array.from(classSet).sort()
    })
    console.log('  All CSS classes on page:', allClasses.join(', '))

    // Check for tables
    const tables = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table')).map(t => ({
        id: t.id,
        class: t.className,
        rows: t.rows.length,
        firstRowText: t.rows[0]?.innerText?.substring(0, 100) || 'N/A'
      }))
    })
    console.log('  Tables found:', JSON.stringify(tables, null, 2))

    // Check for result links
    const resultLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).filter(a =>
        a.href.includes('datalet') || a.href.includes('Datalet')
      ).map(a => ({
        text: a.innerText.substring(0, 80),
        href: a.href
      }))
    })
    console.log('  Result links:', JSON.stringify(resultLinks, null, 2))

    // Check for main content area
    const contentDivs = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div[id], main, [role="main"], .content, #content, .main'))
      return divs.map(d => ({
        tag: d.tagName,
        id: d.id,
        class: d.className,
        textLength: d.innerText.length,
        textPreview: d.innerText.substring(0, 150)
      }))
    })
    console.log('  Content divs:', JSON.stringify(contentDivs.filter(d => d.textLength > 50), null, 2))

    // Get page body text
    const bodyText = await page.evaluate(() => document.body.innerText)
    console.log('\n  === PAGE TEXT (first 1000 chars) ===')
    console.log(bodyText.substring(0, 1000))

    // Try clicking first result if it's a search results page
    if (resultLinks.length > 0) {
      console.log('\n4. Clicking first result link...')
      await page.click(`a[href*="datalet"]`)
      await page.waitForTimeout(3000)

      await page.screenshot({ path: '/tmp/jc-step4-detail.png' })
      console.log('  Screenshot: /tmp/jc-step4-detail.png')

      const detailClasses = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'))
        const classSet = new Set()
        elements.forEach(el => {
          el.classList.forEach(c => classSet.add(c))
        })
        return Array.from(classSet).sort()
      })
      console.log('  Detail page CSS classes:', detailClasses.join(', '))

      const detailText = await page.evaluate(() => document.body.innerText)
      console.log('\n  === DETAIL PAGE TEXT (first 2000 chars) ===')
      console.log(detailText.substring(0, 2000))

      // Check for values tab link
      console.log('\n5. Navigating to values tab...')
      await page.goto(
        'https://publicaccess.jacksongov.org/datalets/datalet.aspx?mode=valuesall&sIndex=0&idx=1&LMparent=20',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      )
      await page.waitForTimeout(2000)

      await page.screenshot({ path: '/tmp/jc-step5-values.png' })
      console.log('  Screenshot: /tmp/jc-step5-values.png')

      const valuesText = await page.evaluate(() => document.body.innerText)
      console.log('\n  === VALUES TAB TEXT (first 2000 chars) ===')
      console.log(valuesText.substring(0, 2000))

      // Residential tab
      console.log('\n6. Navigating to residential tab...')
      await page.goto(
        'https://publicaccess.jacksongov.org/datalets/datalet.aspx?mode=residential&sIndex=0&idx=1&LMparent=20',
        { waitUntil: 'domcontentloaded', timeout: 30000 }
      )
      await page.waitForTimeout(2000)

      await page.screenshot({ path: '/tmp/jc-step6-residential.png' })
      console.log('  Screenshot: /tmp/jc-step6-residential.png')

      const residentialText = await page.evaluate(() => document.body.innerText)
      console.log('\n  === RESIDENTIAL TAB TEXT (first 2000 chars) ===')
      console.log(residentialText.substring(0, 2000))
    }
  } else {
    console.log('  ✗ Search fields not found')
  }

  await browser.close()
  console.log('\n✓ Exploration complete')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
