import { expect, test, type Page } from '@playwright/test'

const SUPABASE_LOCAL = 'http://127.0.0.1:54321'

async function installSyntheticRoutes(page: Page) {
  await page.route(`${SUPABASE_LOCAL}/**`, async (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/manifests')) {
      await route.fulfill({ json: [] })
      return
    }
    if (url.includes('/rest/v1/lead_activities')) {
      await route.fulfill({ json: [] })
      return
    }
    if (url.includes('/rest/v1/leads')) {
      await route.fulfill({ json: [] })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.route('**/api/**', async (route) => {
    await route.fulfill({ json: {} })
  })

  await page.route('**/api/twilio-token', async (route) => {
    await route.fulfill({
      json: { error: 'Synthetic test blocks Twilio registration.' },
    })
  })

  await page.route('**/api/call-log**', async (route) => {
    await route.fulfill({ json: { calls: [] } })
  })

  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({ json: { profile: null } })
  })

  await page.route('**/api/dashboard/kpis', async (route) => {
    await route.fulfill({
      json: {
        agent: 'Synthetic',
        monthly: [],
        ytd: {
          dialTimeHrs: 0,
          calls: 0,
          contacts: 0,
          leads: 0,
          appointments: 0,
          contactRate: '0',
          leadRate: '0',
          months: 1,
        },
      },
    })
  })

  await page.route('**/api/dashboard/appointment-stats', async (route) => {
    await route.fulfill({
      json: {
        showRate30Day: 0,
        totalAppointments: 0,
        completed: 0,
        noShows: 0,
        cancelled: 0,
        ghostProtocolRecoveryRate: 0,
      },
    })
  })

  await page.route('**/api/financials**', async (route) => {
    await route.fulfill({
      json: {
        total: {
          revenue: 0,
          expenses: 0,
          net: 0,
          last_updated: new Date().toISOString(),
        },
      },
    })
  })

  await page.route('**/api/dialer/queue**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('ids_only')) {
      await route.fulfill({ json: { leadIds: ['lead-1'] } })
      return
    }
    await route.fulfill({
      json: {
        leads: [
          {
            id: 'lead-1',
            full_name: 'Estate of Robert Taylor',
            phone: null,
            email: null,
            property_address: '123 Synthetic Ave',
            city: 'Kansas City',
            state: 'MO',
            zip: '64108',
            county: 'Jackson',
            is_favorite: false,
            source: 'synthetic',
            station: 'intake',
            priority: 'normal',
            seller_situation: null,
            motivation_score: 80,
            appointment_date: null,
            created_at: '2026-05-05T00:00:00.000Z',
            updated_at: '2026-05-05T00:00:00.000Z',
          },
        ],
        prospects: [
          {
            id: 'prospect-1',
            lead_id: 'lead-1',
            owner_1: 'ROBERT TAYLOR',
            cumulative_due: 4200,
            earliest_delinquent_year: 2022,
            delinquent_years_category: '3+',
            total_market_value: 122000,
            zestimate: 135000,
            situs_street: '123 Synthetic Ave',
            situs_city: 'Kansas City',
            situs_state: 'MO',
            situs_zip: '64108',
            mailing_street: null,
            mailing_city: null,
            mailing_state: null,
            mailing_zip: null,
            county: 'Jackson',
          },
        ],
      },
    })
  })

  await page.route('**/api/heirs?**', async (route) => {
    await route.fulfill({
      json: {
        last_skip_traced_at: '2026-05-05T00:00:00.000Z',
        heirs: [
          {
            key: 'heir-1',
            contact_name: 'Angela Taylor',
            relationship: 'daughter',
            address: null,
            unattempted_count: 2,
            phones: [
              {
                id: 'phone-1',
                number: '+18166088588',
                type: 'mobile',
                connected: null,
                attempted: false,
                last_disposition: null,
                last_attempt_at: null,
              },
              {
                id: 'phone-2',
                number: '+18167277667',
                type: 'mobile',
                connected: null,
                attempted: false,
                last_disposition: null,
                last_attempt_at: null,
              },
            ],
          },
        ],
      },
    })
  })
}

async function expectDialerDocked(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dialer' })).toBeVisible()

  const state = await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h2')).find(
      (el) => el.textContent?.trim() === 'Dialer',
    )
    const fixedShell = heading?.closest('div[class*="fixed"]') as HTMLElement | null
    const box = fixedShell?.getBoundingClientRect()
    const className = String(fixedShell?.className ?? '')
    const allDivs = Array.from(document.querySelectorAll('div'))

    const backdropCount = allDivs.filter((el) => {
      const classes = String(el.className)
      return (
        classes.includes('fixed inset-0') &&
        classes.includes('z-[60]') &&
        (classes.includes('bg-black/45') || classes.includes('backdrop-blur'))
      )
    }).length

    const centeredModalShellCount = allDivs.filter((el) => {
      const classes = String(el.className)
      return (
        classes.includes('fixed inset-0') &&
        classes.includes('z-[70]') &&
        classes.includes('items-center') &&
        classes.includes('justify-center')
      )
    }).length

    return {
      className,
      backdropCount,
      centeredModalShellCount,
      box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })

  expect(state.className, 'Dialer shell should use the docked right/bottom placement').toContain('right-')
  expect(state.className, 'Dialer shell should use the docked right/bottom placement').toContain('bottom-')
  expect(state.className, 'Dialer shell must not use full-screen modal inset placement').not.toContain('inset-0')
  expect(state.backdropCount, 'Dialer must not create a full-screen backdrop').toBe(0)
  expect(state.centeredModalShellCount, 'Dialer must not create a centered modal shell').toBe(0)
  expect(state.box, 'Dialer shell should have a measurable bounding box').not.toBeNull()
  expect(state.box!.x, 'Dialer should be docked on the right half of the viewport').toBeGreaterThan(state.viewport.width / 2)
  expect(
    state.box!.y + state.box!.height,
    'Dialer should be anchored to the lower edge of the viewport',
  ).toBeGreaterThan(state.viewport.height - 48)
}

test.describe('dialer dock presentation synthetic checks', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ page }) => {
    await installSyntheticRoutes(page)
  })

  test('header dialer opens docked, not as a popup, outside the dialer page', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Open dialer' }).click()

    await expectDialerDocked(page)
  })

  test('heir queue launch calls every heir phone and opens docked without a backdrop', async ({ page }) => {
    await page.goto(
      '/dialer?lead_ids=lead-1&queue_label=3%2B%20Year%20Deceased%20Tax&caller_id=%2B18166088588&call_hammer=0',
      { waitUntil: 'domcontentloaded' },
    )

    await expect(page.getByText('1 of 1 leads')).toBeVisible()
    await expect(page.getByText('3+ Year Deceased Tax')).toBeVisible()

    await page.getByRole('button', { name: /Call heirs \(2\)/ }).click()

    await expect(page.getByText('Heir queue · 1 of 2')).toBeVisible()
    await expectDialerDocked(page)
  })
})
