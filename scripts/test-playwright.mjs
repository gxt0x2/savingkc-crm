#!/usr/bin/env node

import { chromium } from 'playwright'

async function main() {
  console.log('Testing Playwright Chromium...\n')

  console.log('1. Launching browser...')
  const browser = await chromium.launch({
    headless: true,
    timeout: 30000
  })
  console.log('✓ Browser launched')

  console.log('\n2. Creating new page...')
  const page = await browser.newPage()
  console.log('✓ Page created')

  console.log('\n3. Loading Jackson County website...')
  try {
    await page.goto('https://publicaccess.jacksongov.org/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    console.log('✓ Page loaded')

    const title = await page.title()
    console.log(`  Page title: "${title}"`)

    console.log('\n4. Checking for .WidgetBar selector...')
    const hasWidgetBar = await page.evaluate(() => {
      return document.querySelector('.WidgetBar') !== null
    })
    console.log(`  .WidgetBar exists: ${hasWidgetBar}`)

    if (!hasWidgetBar) {
      console.log('\n5. Looking for similar selectors...')
      const selectors = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('[class*="widget" i], [id*="widget" i]'))
        return elements.map(el => ({
          tag: el.tagName,
          class: el.className,
          id: el.id
        })).slice(0, 10)
      })
      console.log('  Found elements:', selectors)
    }

    console.log('\n6. Taking screenshot...')
    await page.screenshot({ path: '/tmp/jackson-county-test.png' })
    console.log('  Screenshot saved to /tmp/jackson-county-test.png')

  } catch (err) {
    console.error('✗ Error:', err.message)
  }

  await browser.close()
  console.log('\n✓ Test complete')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
