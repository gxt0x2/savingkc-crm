import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const crmWorkspaceRoutes = [
  '/leads',
  '/contacts',
  '/conversations',
  '/opportunities',
  '/calendar?department=acquisitions',
  '/workflows',
  '/marketing',
  '/dispo/pipeline',
  '/dashboard',
  '/settings',
];
const artifactDir = path.join(process.cwd(), 'test-results', 'smoke');

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
  await page.getByRole('button', { name: 'New workflow' }).click();
  await expect(page.getByRole('dialog', { name: 'Workflow safety requirements' })).toBeVisible();
  await page.getByRole('button', { name: 'Understood' }).click();
  await expect(page.getByRole('dialog', { name: 'Workflow safety requirements' })).toHaveCount(0);

  const firstWorkflow = page.getByRole('row').nth(1);
  await firstWorkflow.click();
  await expect(page.getByRole('dialog', { name: /workflow details/i })).toBeVisible();
});

test('rebuilt CRM navigation has no placeholder destinations', async ({ page }) => {
  await page.goto('/contacts', { waitUntil: 'domcontentloaded' });

  const expectedLinks = new Map([
    ['Conversations', '/conversations'],
    ['Opportunities', '/opportunities'],
    ['Contacts', '/contacts'],
    ['Calendar & Tasks', '/calendar?department=acquisitions'],
    ['Workflows', '/workflows'],
    ['Marketing', '/marketing'],
    ['Dispositions', '/dispo/pipeline'],
    ['Reports', '/dashboard'],
    ['Settings', '/settings'],
  ]);

  for (const [name, href] of expectedLinks) {
    await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
  }

  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});

for (const route of crmWorkspaceRoutes) {
  test(`approved CRM workspace smoke: ${route}`, async ({ page }) => {
    mkdirSync(artifactDir, { recursive: true });

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await expect(page.locator('body.ck-dark')).toHaveCount(0);
    await expect(page.getByPlaceholder('Search contacts, properties, or messages...')).toBeVisible();
    await expect(page.getByRole('link', { name: /Conversations/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contacts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dispositions' })).toHaveAttribute('href', '/dispo/pipeline');
    await expect(page.locator('a[href="#"]')).toHaveCount(0);

    await page.screenshot({
      path: path.join(artifactDir, `${route.replace(/\//g, '_') || 'root'}.png`),
      fullPage: true,
    });
  });
}
