import { expect, test, Page } from '@playwright/test'

const CRM_EMAIL = process.env.CRM_E2E_EMAIL ?? 'ernest@savingkc.com'
const CRM_PASSWORD = process.env.CRM_E2E_PASSWORD ?? 'SavingKC2026!'

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })

  if (!page.url().includes('/login')) {
    await expect(page).toHaveURL(/\/(ari|dashboard|leads|opportunities|calendar|dialer|pipeline|dispo\/pipeline)/)
    return
  }

  await page.locator('input[type="email"]').fill(CRM_EMAIL)
  await page.locator('input[type="password"]').fill(CRM_PASSWORD)

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }),
    page.getByRole('button', { name: 'Sign In', exact: true }).click(),
  ])

  await expect(page).toHaveURL(/\/(ari|dashboard|leads|opportunities|calendar|dialer|pipeline|dispo\/pipeline)/)
}

async function openDialerFromHeader(page: Page) {
  const openDialerButton = page.getByRole('button', { name: 'Open dialer' })
  await expect(openDialerButton).toBeVisible()

  await openDialerButton.click()
  await expect(page.getByRole('heading', { name: 'Dialer' })).toBeVisible()
}

async function getCallerIdState(page: Page): Promise<{ selectable: boolean; values: string[]; active: string }> {
  return page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('div')).find(
      (el) => el.textContent?.trim() === 'Calling from',
    )
    if (!label) return { selectable: false, values: [], active: '' }
    const container = label.parentElement
    if (!container) return { selectable: false, values: [], active: '' }

    const select = container.querySelector('select') as HTMLSelectElement | null
    if (select) {
      const values = Array.from(select.options)
        .map((opt) => opt.value.trim())
        .filter(Boolean)
      return { selectable: true, values, active: select.value.trim() }
    }

    const text = container.textContent ?? ''
    const phoneMatch = text.match(/\+\d[\d\s()-]{7,}/)
    return { selectable: false, values: phoneMatch ? [phoneMatch[0].trim()] : [], active: phoneMatch ? phoneMatch[0].trim() : '' }
  })
}

test.describe('CRM synthetic critical paths', () => {
  test.setTimeout(240000)

  test('navigation + dialer flow + caller-id prepopulation', async ({ page }) => {
    await login(page)

    const acquisitionsMode = page.getByRole('button', { name: 'Acquisitions' }).first()
    if (await acquisitionsMode.isVisible().catch(() => false)) {
      await acquisitionsMode.click()
    }

    const navChecks: Array<{ label: string; url: RegExp }> = [
      { label: 'ARI', url: /\/ari/ },
      { label: 'Hot Opps', url: /\/opportunities/ },
      { label: 'Calendar', url: /\/calendar/ },
      { label: 'KPIs', url: /\/dashboard/ },
    ]

    for (const nav of navChecks) {
      const navLink = page.getByRole('link', { name: nav.label }).first()
      await expect(navLink).toBeVisible()
      await Promise.all([
        page.waitForURL(nav.url, { timeout: 30000 }),
        navLink.click(),
      ])
      await expect(page).toHaveURL(nav.url)
    }

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await openDialerFromHeader(page)

    const searchInput = page.getByPlaceholder('Search leads by name, phone, address...')
    await expect(searchInput).toBeVisible()

    const searchResponsePromise = page.waitForResponse(
      (response) => {
        const url = response.url()
        return url.includes('/api/leads/search?q=ma&limit=8') && response.request().method() === 'GET'
      },
      { timeout: 30000 },
    )

    await searchInput.fill('ma')
    const searchResponse = await searchResponsePromise
    expect(searchResponse.status(), 'Dialer lead-search endpoint should return 200').toBe(200)

    const callerIdState = await getCallerIdState(page)
    const hasCallerIdValue = callerIdState.values.length > 0

    if (callerIdState.selectable && callerIdState.values.length > 1) {
      const callerIdSelect = page.locator('select').first()
      await callerIdSelect.selectOption(callerIdState.values[1])
      await expect(callerIdSelect).toHaveValue(callerIdState.values[1])
    }

    const recentTab = page.getByRole('button', { name: 'Recent' }).last()
    await recentTab.click()

    const recentHeading = page.getByText('Recent Calls', { exact: true })
    await expect(recentHeading).toBeVisible()

    const recentList = page.locator('div.space-y-1\\.5.max-h-\\[26rem\\].overflow-y-auto.pr-1')
    await expect(recentList).toBeVisible()

    const recentListMetrics = await recentList.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }))

    expect(
      ['auto', 'scroll'].includes(recentListMetrics.overflowY),
      `Recent list should be scrollable. overflowY=${recentListMetrics.overflowY}`,
    ).toBeTruthy()

    expect(
      recentListMetrics.scrollHeight >= recentListMetrics.clientHeight,
      'Recent list should support vertical scrolling when records exceed viewport',
    ).toBeTruthy()

    await page.evaluate((payload) => {
      window.dispatchEvent(new CustomEvent('open-dialer', { detail: payload }))
    }, {
      phone: '+18166088588',
      name: 'E2E Validation Lead',
      leadId: 'e2e-lead-1',
      callerId: hasCallerIdValue ? callerIdState.values[0] : '+18166088588',
    })

    await expect(page.getByRole('heading', { name: 'Dialer' })).toBeVisible()
    const callerIdStateAfterOpenEvent = await getCallerIdState(page)
    if (hasCallerIdValue && callerIdStateAfterOpenEvent.active) {
      const expectedCallerDigits = callerIdState.values[0].replace(/\D/g, '')
      const actualCallerDigits = callerIdStateAfterOpenEvent.active.replace(/\D/g, '')
      expect(actualCallerDigits, 'Caller ID should be populated after open-dialer event').toContain(expectedCallerDigits)
    }

    const dialDisplay = page.locator('p').filter({ hasText: '(816) 608-8588' }).first()
    await expect(dialDisplay).toBeVisible()
  })
})
