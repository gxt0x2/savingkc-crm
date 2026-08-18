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
  '/reports/andon',
  '/reports/finance',
  '/reports/call-sms',
  '/settings',
];
const artifactDir = path.join(process.cwd(), 'test-results', 'smoke');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.localStorage.getItem('crm-theme-smoke-seeded') !== 'true') {
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
    ['Issue Log', '/reports/andon'],
    ['Pipeline', '/contacts?list=new'],
    ['Conversations', '/conversations'],
    ['Calendar', '/calendar?department=acquisitions'],
    ['Dialer', '/dialer'],
    ['Task', '/tasks'],
    ['Reports', '/reports/acquisitions'],
    ['Settings', '/settings'],
  ]);

  for (const [name, href] of expectedLinks) {
    const destination = page.locator(`a[href="${href}"]`).filter({ hasText: name });
    await expect(destination).toBeVisible();
  }

  await expect(page.getByRole('link', { name: 'Bingo Board' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Bottlenecks' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'AI Assistant' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ARI Insights' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open AI Assistant' })).toBeVisible();
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});

test('Issue Log is the sole Andon dashboard and Marketing replaces the retired dashboard tab', async ({ page }) => {
  await page.goto('/reports/bottlenecks', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/reports\/andon$/);
  await expect(page.getByRole('heading', { name: 'Issue Log' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Issue Log', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Dashboards sections' }).getByRole('link', { name: /Marketing/ })).toHaveAttribute('href', '/reports/marketing');
  await expect(page.getByRole('heading', { name: 'Bottleneck Board' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open AI Assistant' }).click();
  await expect(page.getByText(/SavingKC's recorded goals/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach evidence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toBeAttached();

  await page.getByLabel('Attach files to AI request').setInputFiles({
    name: 'operating-note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Verify this evidence against SavingKC goals and operating path.'),
  });
  await expect(page.getByText('operating-note.txt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove operating-note.txt' })).toBeVisible();
});

test('Marketing dashboard remains primary and opens Google Ads as a subpage', async ({ page }) => {
  await page.goto('/marketing', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/reports\/marketing$/);

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  const marketingDashboard = page.getByRole('navigation', { name: 'Dashboards sections' }).getByRole('link', { name: /Marketing/ });
  await expect(marketingDashboard).toHaveAttribute('href', '/reports/marketing');
  await marketingDashboard.click();

  await expect(page).toHaveURL(/\/reports\/marketing$/);
  await expect(page.getByRole('heading', { name: 'Marketing performance', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboards sections' }).getByRole('link', { name: /Marketing/ })).toHaveAttribute('aria-current', 'page');
  await page.locator('a[href="/marketing/google-ads"]').filter({ hasText: 'Google Ads' }).click();

  await expect(page).toHaveURL(/\/marketing\/google-ads$/);
  await expect(page.getByRole('heading', { name: 'Google Ads performance', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Marketing overview' })).toHaveAttribute('href', '/reports/marketing');
  await expect(page.getByRole('navigation', { name: 'Marketing sections' }).getByRole('link', { name: /Google Ads/ })).toHaveAttribute('aria-current', 'page');
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
    const desktopNavigation = page.getByRole('navigation', { name: 'CRM navigation' });
    await expect(desktopNavigation.getByRole('link', { name: 'Conversations' })).toBeVisible();
    await expect(desktopNavigation.getByRole('link', { name: 'Pipeline' })).toBeVisible();
    await expect(desktopNavigation.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
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
