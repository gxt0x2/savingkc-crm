import { expect, test } from '@playwright/test'

const tasks = [
  {
    id: '8fc14e59-85ca-42ec-b4be-3d48a9228da3',
    type: 'follow_up',
    title: 'Call Michael',
    description: 'Confirm the seller appointment and property access.',
    contact_id: 'a40ebbb5-bb99-4f11-aeae-efb7d64d8949',
    deal_id: null,
    property_address: '123 Main St, Kansas City, MO',
    due_date: '2027-07-14T13:59:00.000Z',
    assigned_to: 'Casey',
    status: 'pending',
    created_at: '2026-08-10T12:00:00.000Z',
    contact: { id: 'a40ebbb5-bb99-4f11-aeae-efb7d64d8949', first_name: 'Michael', last_name: 'Maddox' },
  },
  {
    id: 'b76033ba-5e83-4828-9471-4fb4add3718d',
    type: 'send_offer',
    title: 'Send revised offer',
    description: 'Update the offer after the repair review.',
    contact_id: 'ad2d3399-9f7c-4170-b233-655595e34ae9',
    deal_id: null,
    property_address: '6509 W 74th St, Overland Park, KS',
    due_date: '2026-08-09T18:00:00.000Z',
    assigned_to: 'Ernest',
    status: 'pending',
    created_at: '2026-08-09T12:00:00.000Z',
    contact: { id: 'ad2d3399-9f7c-4170-b233-655595e34ae9', first_name: 'Joseph', last_name: 'Cross' },
  },
  {
    id: 'c8f55640-81ed-443d-907e-746252f0c08f',
    type: 'task',
    title: 'Review completed call',
    description: 'QA the call notes and confirm disposition.',
    contact_id: null,
    deal_id: null,
    property_address: null,
    due_date: '2026-08-08T17:00:00.000Z',
    assigned_to: 'Gertha',
    status: 'completed',
    created_at: '2026-08-08T12:00:00.000Z',
  },
]

test('Tasks renders the contact-style workspace and closes the work loop', async ({ page }) => {
  await page.route(/\/api\/calendar\/tasks\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, tasks }) })
  })
  await page.route(/\/api\/calendar\/tasks\/(bulk|[^?]+)$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changed: 3 }) })
  })
  await page.route('**/api/conversations/hub**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [] }) })
  })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/tasks')

  await expect(page.getByTestId('tasks-command-header')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Task smart lists' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark Call Michael complete' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete Call Michael' })).toBeVisible()

  const shell = page.locator('.crm-workspace-shell')
  const initialTheme = await shell.getAttribute('data-theme')
  await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click()
  await expect(shell).not.toHaveAttribute('data-theme', initialTheme || '')

  await page.getByRole('button', { name: 'Mark Call Michael complete' }).click()
  await expect(page.getByRole('button', { name: 'Reopen Call Michael' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Task completed.')

  await page.getByRole('checkbox', { name: 'Select tasks on this page' }).check()
  const bulkBar = page.getByRole('region', { name: 'Bulk task changes' })
  await expect(bulkBar).toBeVisible()
  await bulkBar.getByRole('combobox', { name: 'Bulk action' }).selectOption('assign:Gertha')
  await bulkBar.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('status')).toContainText('3 tasks updated.')

  await page.getByRole('button', { name: 'Delete Send revised offer' }).click()
  const deleteDialog = page.getByRole('alertdialog')
  await expect(deleteDialog).toContainText('Send revised offer')
  await deleteDialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('button', { name: 'Delete Send revised offer' })).toHaveCount(0)

  await page.screenshot({ path: '/tmp/savingkc-tasks-preview.png', fullPage: true })
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
