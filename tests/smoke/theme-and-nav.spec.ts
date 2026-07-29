import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

function luminanceFromRgb(cssColor: string): number {
  const match = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return 255;
  const [, r, g, b] = match.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const routes = ['/ari', '/dispo/pipeline'];
const crmWorkspaceRoutes = ['/leads', '/contacts', '/conversations', '/workflows'];
const artifactDir = path.join(process.cwd(), 'test-results', 'smoke');

for (const route of routes) {
  test(`dark shell smoke: ${route}`, async ({ page }) => {
    mkdirSync(artifactDir, { recursive: true });

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    await expect(page.locator('body.ck-dark')).toBeVisible();

    const header = page.locator('header.sticky').first();
    await expect(header).toBeVisible();

    const headerBg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
    const headerLum = luminanceFromRgb(headerBg);

    expect(
      headerLum,
      `Header background is too light (${headerBg}) on route ${route}.`
    ).toBeLessThan(120);

    const modeSwitcher = page.locator('header').locator('button', { hasText: 'Acquisitions' }).first();
    if (await modeSwitcher.isVisible().catch(() => false)) {
      const switcherBg = await modeSwitcher.evaluate((el) => getComputedStyle(el).backgroundColor);
      const switcherLum = luminanceFromRgb(switcherBg);
      expect(
        switcherLum,
        `Mode switcher looks too light (${switcherBg}) on route ${route}.`
      ).toBeLessThan(140);
    }

    await page.screenshot({
      path: path.join(artifactDir, `${route.replace(/\//g, '_') || 'root'}.png`),
      fullPage: true,
    });
  });
}

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

    await page.screenshot({
      path: path.join(artifactDir, `${route.replace(/\//g, '_') || 'root'}.png`),
      fullPage: true,
    });
  });
}
