import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const crmWorkspaceRoutes = [
  '/leads',
  '/contacts',
  '/conversations',
  '/opportunities',
  '/calendar?department=acquisitions',
  '/tasks',
  '/workflows',
  '/marketing',
  '/dispo/pipeline',
  '/dispo/deals',
  '/dispo/buyers',
  '/dispo/offers',
  '/dispo/broadcasts',
  '/dispo/tc',
  '/dispo/vendors',
  '/dispo/contacts',
  '/dashboard',
  '/reports/marketing',
  '/reports/acquisitions',
  '/reports/dispositions',
  '/reports/finance',
  '/reports/call-sms',
  '/ari',
  '/settings',
];
const artifactDir = path.join(process.cwd(), 'test-results', 'smoke');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('crm-theme-smoke-seeded')) {
      window.localStorage.setItem('crm-theme', 'light');
      window.localStorage.setItem('crm-theme-smoke-seeded', 'true');
    }
  });
});

test('CRM controls are interactive instead of decorative', async ({ page }) => {
  await page.goto('/contacts', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByRole('dialog', { name: 'Add contact' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Add contact' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('dialog', { name: 'Import contacts' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
  const newWorkflowButton = page.getByRole('button', { name: 'New workflow' });
  await newWorkflowButton.click();
  const safetyDialog = page.getByRole('dialog', { name: 'Create workflow draft' });
  await expect(safetyDialog).toBeVisible();
  await expect(safetyDialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Create workflow draft' })).toHaveCount(0);
  await expect(newWorkflowButton).toBeFocused();

  const firstWorkflow = page.getByRole('button', { name: /open .* workflow details/i }).first();
  await firstWorkflow.click();
  const workflowDetails = page.getByRole('dialog', { name: /workflow details/i });
  await expect(workflowDetails).toBeVisible();
  await expect(workflowDetails.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(workflowDetails).toHaveCount(0);
  await expect(firstWorkflow).toBeFocused();
});

test('rebuilt CRM navigation has no placeholder destinations', async ({ page }) => {
  await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.crm-workspace-shell')).toBeVisible();

  const expectedLinks = new Map([
    ['Dashboard', '/dashboard'],
    ['Contacts', '/contacts'],
    ['Conversations', '/conversations'],
    ['Calendar', '/calendar?department=acquisitions'],
    ['Task', '/tasks'],
    ['Dispositions', '/dispo/pipeline'],
    ['ARI Insights', '/ari'],
    ['Workflows', '/workflows'],
    ['Settings', '/settings'],
  ]);

  for (const [name, href] of expectedLinks) {
    const destination = page.locator(`a[href="${href}"]`).filter({ hasText: name });
    await expect(destination).toBeVisible();
  }

  await page.getByRole('button', { name: 'Expand dashboard menu' }).click();
  const dashboardLinks = new Map([
    ['Acquisitions', '/reports/acquisitions'],
    ['Dispositions', '/reports/dispositions'],
  ]);
  for (const [name, href] of dashboardLinks) {
    await expect(page.locator(`a[href="${href}"]`).filter({ hasText: name })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Reports' }).click();
  const reportLinks = new Map([
    ['Marketing', '/reports/marketing'],
    ['Finance', '/reports/finance'],
    ['Call/SMS', '/reports/call-sms'],
  ]);
  for (const [name, href] of reportLinks) {
    await expect(page.locator(`a[href="${href}"]`).filter({ hasText: name })).toBeVisible();
  }

  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});

for (const route of crmWorkspaceRoutes) {
  test(`approved CRM workspace smoke: ${route}`, async ({ page }) => {
    mkdirSync(artifactDir, { recursive: true });

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await expect(page.locator('body.ck-dark')).toHaveCount(0);
    await expect(page.locator('.crm-workspace-shell')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
    const commandSearch = route === '/contacts'
      ? page.getByPlaceholder('Search contacts...')
      : route === '/tasks'
        ? page.getByPlaceholder('Search tasks...')
        : page.getByPlaceholder('Search contacts, properties, or messages...');
    await expect(commandSearch).toBeVisible();
    await expect(page.locator('a[href="/conversations"]').filter({ hasText: 'Conversations' })).toBeVisible();
    await expect(page.locator('a[href="/contacts"]').filter({ hasText: 'Contacts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('a[href="#"]')).toHaveCount(0);

    await page.screenshot({
      path: path.join(artifactDir, `${route.replace(/[^a-z0-9_-]+/gi, '_') || 'root'}.png`),
      fullPage: true,
    });
  });
}

test('rebuilt CRM honors and persists dark and light theme preference', async ({ page }) => {
  await page.goto('/workflows', { waitUntil: 'domcontentloaded' });
  const shell = page.locator('.crm-workspace-shell');

  await expect(shell).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveClass(/ck-dark/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.crm-workspace-shell')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('crm-theme'))).toBe('light');
  await expect(page.locator('.crm-workspace-shell')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body.ck-dark')).toHaveCount(0);
});

test('closing coordination uses the rebuilt shell and shared theme', async ({ page }) => {
  await page.goto('/dispo/tc', { waitUntil: 'domcontentloaded' });

  const shell = page.locator('.crm-workspace-shell');
  const heading = page.getByRole('heading', { name: 'Closing coordination' });
  const portal = page.locator('main').filter({ has: heading });
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('navigation', { name: 'Dispositions sections' })).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(page.locator('.tc-portal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => portal.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(23, 24, 26)');
});
