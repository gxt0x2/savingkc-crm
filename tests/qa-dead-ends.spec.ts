import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface Finding {
  page: string;
  type: 'dead-link' | 'console-error' | 'broken-image' | 'empty-state' | '404-link' | 'network-failure' | 'non-200-response';
  severity: 'high' | 'medium' | 'low';
  message: string;
  details?: any;
}

interface QAReport {
  timestamp: string;
  totalFindings: number;
  findingsByType: Record<string, number>;
  findingsBySeverity: Record<string, number>;
  findings: Finding[];
}

const ROUTES = [
  '/dashboard',
  '/opportunities',
  '/contacts',
  '/conversations',
  '/calendar',
  '/pipeline',
  '/settings',
  '/checklist',
];

const findings: Finding[] = [];
const consoleErrors: string[] = [];

function addFinding(finding: Finding) {
  findings.push(finding);
}

async function checkDeadLinks(page: Page, route: string) {
  // Find all links
  const links = await page.locator('a[href]').all();

  for (const link of links) {
    const href = await link.getAttribute('href');
    const text = await link.textContent();
    const isVisible = await link.isVisible().catch(() => false);

    if (!isVisible) continue;

    // Check for dead links
    if (href === '#' || href === '' || href === 'javascript:void(0)') {
      const onclick = await link.getAttribute('onclick');
      if (!onclick || onclick.trim() === '') {
        addFinding({
          page: route,
          type: 'dead-link',
          severity: 'medium',
          message: `Dead link found: "${text?.trim() || 'No text'}"`,
          details: { href, text: text?.trim() }
        });
      }
    }

    // Check for links to unknown routes (potential 404s)
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      const knownRoutes = [
        '/', '/login', '/dashboard', '/opportunities', '/contacts', '/leads', '/conversations',
        '/calendar', '/pipeline', '/settings', '/checklist'
      ];
      const baseRoute = href.split('?')[0].split('#')[0];

      // Check if it's a dynamic route pattern or known route
      const isDynamicRoute = baseRoute.includes('[') || /\/leads\/\d+/.test(baseRoute);
      const isKnownRoute = knownRoutes.some(r => baseRoute === r || baseRoute.startsWith(r + '/'));

      if (!isDynamicRoute && !isKnownRoute && !baseRoute.match(/^\/leads\/[a-f0-9-]+$/i)) {
        addFinding({
          page: route,
          type: '404-link',
          severity: 'high',
          message: `Link to potentially unknown route: ${baseRoute}`,
          details: { href: baseRoute, text: text?.trim() }
        });
      }
    }
  }

  // Find all buttons
  const buttons = await page.locator('button:visible').all();

  for (const button of buttons) {
    const onclick = await button.getAttribute('onclick');
    const type = await button.getAttribute('type');
    const text = await button.textContent();
    const hasClickHandler = await button.evaluate((el) => {
      // Check if button has any event listeners
      const events = (window as any).getEventListeners?.(el);
      return events && events.click && events.click.length > 0;
    }).catch(() => false);

    // Skip if it's a submit button or has clear handlers
    if (type === 'submit' || onclick || hasClickHandler) continue;

    // Check if button is inside a form
    const inForm = await button.evaluate((el) => {
      return el.closest('form') !== null;
    });

    if (inForm) continue;

    // Check if it has aria-label or title that suggests it's interactive
    const ariaLabel = await button.getAttribute('aria-label');
    const title = await button.getAttribute('title');

    if (!ariaLabel && !title && text?.trim()) {
      addFinding({
        page: route,
        type: 'dead-link',
        severity: 'low',
        message: `Button with no obvious handler: "${text.trim()}"`,
        details: { text: text.trim() }
      });
    }
  }
}

async function checkBrokenImages(page: Page, route: string) {
  const images = await page.locator('img[src]:visible').all();

  for (const img of images) {
    const src = await img.getAttribute('src');
    const alt = await img.getAttribute('alt');

    const isBroken = await img.evaluate((el: HTMLImageElement) => {
      return el.naturalWidth === 0 && el.complete;
    });

    if (isBroken) {
      addFinding({
        page: route,
        type: 'broken-image',
        severity: 'medium',
        message: `Broken image: ${src}`,
        details: { src, alt }
      });
    }
  }
}

async function checkEmptyStates(page: Page, route: string) {
  // Look for common empty data container patterns
  const emptySelectors = [
    'table tbody:empty',
    '[class*="empty"]:not(:has(*))',
    '[class*="no-data"]:not(:has(*))',
    '[class*="no-results"]:not(:has(*))',
  ];

  for (const selector of emptySelectors) {
    const elements = await page.locator(selector).all();

    for (const el of elements) {
      const isVisible = await el.isVisible();
      if (!isVisible) continue;

      const parent = el.locator('..');
      const hasEmptyMessage = await parent.locator('text=/no.*data|no.*results|empty|nothing to show/i').count();

      if (hasEmptyMessage === 0) {
        const html = await el.innerHTML();
        addFinding({
          page: route,
          type: 'empty-state',
          severity: 'low',
          message: `Empty container with no empty-state message`,
          details: { selector, html: html.substring(0, 100) }
        });
      }
    }
  }
}

async function checkNetworkRequests(page: Page, route: string) {
  // Listen for failed requests
  page.on('requestfailed', (request) => {
    addFinding({
      page: route,
      type: 'network-failure',
      severity: 'high',
      message: `Network request failed: ${request.url()}`,
      details: {
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText
      }
    });
  });

  // Listen for non-200 responses
  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();

    // Ignore successful responses and common redirects
    if (status >= 200 && status < 300) return;
    if (status === 304) return; // Not Modified
    if (status === 307 || status === 308) return; // Temporary/Permanent Redirect

    // Ignore favicon and other common 404s
    if (url.includes('favicon.ico')) return;

    // Report other non-200 responses
    if (status >= 400) {
      addFinding({
        page: route,
        type: 'non-200-response',
        severity: status >= 500 ? 'high' : 'medium',
        message: `HTTP ${status} response: ${url}`,
        details: { url, status, statusText: response.statusText() }
      });
    }
  });
}

async function captureConsoleErrors(page: Page, route: string) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();

      // Filter out common React/Next.js noise
      if (text.includes('Download the React DevTools')) return;
      if (text.includes('Lighthouse')) return;

      addFinding({
        page: route,
        type: 'console-error',
        severity: 'medium',
        message: `Console error: ${text}`,
        details: { text, location: msg.location() }
      });
    }
  });
}

test.describe('CRM Dead-End Finder', () => {
  test.beforeAll(async () => {
    console.log('\n🔍 Starting CRM QA audit...\n');
  });

  test('Login and audit all routes', async ({ page }) => {
    // Setup listeners BEFORE navigation
    captureConsoleErrors(page, 'login');
    checkNetworkRequests(page, 'login');

    // Navigate to login page
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Try to login
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitButton = page.locator('button[type="submit"]');

    await emailInput.fill('ernest@savingkc.com');
    await passwordInput.fill('SavingKC2026!');
    await submitButton.click();

    // Wait for navigation or error
    try {
      await page.waitForURL(/\/(dashboard|leads|opportunities)/, { timeout: 10000 });
      console.log('✓ Login successful');
    } catch (error) {
      console.log('✗ Login failed with provided password');
      addFinding({
        page: '/login',
        type: 'console-error',
        severity: 'high',
        message: 'Login failed - unable to authenticate',
        details: { error: String(error) }
      });

      // Attempt to continue anyway for testing purposes
      // In a real scenario, you'd want to handle this better
    }

    // Now audit each route
    for (const route of ROUTES) {
      console.log(`\n📄 Auditing: ${route}`);

      // Setup fresh listeners for this route
      const routePage = page;
      captureConsoleErrors(routePage, route);
      checkNetworkRequests(routePage, route);

      try {
        await routePage.goto(route, { waitUntil: 'networkidle', timeout: 15000 });

        // Wait a bit for dynamic content to load
        await routePage.waitForTimeout(2000);

        // Run all checks
        await checkDeadLinks(routePage, route);
        await checkBrokenImages(routePage, route);
        await checkEmptyStates(routePage, route);

        console.log(`  ✓ Completed checks for ${route}`);
      } catch (error) {
        console.log(`  ✗ Error loading ${route}: ${error}`);
        addFinding({
          page: route,
          type: 'network-failure',
          severity: 'high',
          message: `Failed to load page: ${error}`,
          details: { error: String(error) }
        });
      }
    }

    // Special check: Try to load a sample lead detail page if we can find a lead ID
    try {
      await page.goto('/contacts', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      // Try to find a lead link
      const leadLink = page.locator('a[href*="/leads/"]').first();
      const href = await leadLink.getAttribute('href').catch(() => null);

      if (href && href !== '/contacts') {
        console.log(`\n📄 Auditing: ${href} (lead detail page)`);
        captureConsoleErrors(page, href);
        checkNetworkRequests(page, href);

        await page.goto(href, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);

        await checkDeadLinks(page, href);
        await checkBrokenImages(page, href);
        await checkEmptyStates(page, href);

        console.log(`  ✓ Completed checks for ${href}`);
      }
    } catch (error) {
      console.log(`  ⚠ Could not audit lead detail page: ${error}`);
    }
  });

  test.afterAll(async () => {
    // Generate report
    const report: QAReport = {
      timestamp: new Date().toISOString(),
      totalFindings: findings.length,
      findingsByType: {},
      findingsBySeverity: {},
      findings: findings
    };

    // Count by type
    findings.forEach(f => {
      report.findingsByType[f.type] = (report.findingsByType[f.type] || 0) + 1;
      report.findingsBySeverity[f.severity] = (report.findingsBySeverity[f.severity] || 0) + 1;
    });

    // Write JSON report
    const reportPath = path.join(__dirname, 'qa-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 QA AUDIT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total findings: ${report.totalFindings}`);
    console.log('\nBy severity:');
    console.log(`  🔴 High:   ${report.findingsBySeverity.high || 0}`);
    console.log(`  🟡 Medium: ${report.findingsBySeverity.medium || 0}`);
    console.log(`  🟢 Low:    ${report.findingsBySeverity.low || 0}`);
    console.log('\nBy type:');
    Object.entries(report.findingsByType).forEach(([type, count]) => {
      console.log(`  • ${type}: ${count}`);
    });
    console.log('\n' + '='.repeat(60));
    console.log(`📄 Full report saved to: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    // Print top findings
    if (findings.length > 0) {
      console.log('\n🔍 TOP FINDINGS:\n');
      findings.slice(0, 10).forEach((f, i) => {
        const emoji = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '🟢';
        console.log(`${i + 1}. ${emoji} [${f.page}] ${f.message}`);
      });

      if (findings.length > 10) {
        console.log(`\n... and ${findings.length - 10} more (see qa-report.json for full list)\n`);
      }
    } else {
      console.log('\n✅ No issues found! CRM is clean.\n');
    }
  });
});
