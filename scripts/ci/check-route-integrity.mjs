import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), '.next/server/app-paths-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const routes = Object.keys(manifest);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredRoutes = [
  '/(app)/ai/page',
  '/(app)/ari/page',
  '/(app)/leads/page',
  '/(app)/leads/[id]/page',
  '/(app)/contacts/page',
  '/(app)/conversations/page',
  '/(app)/opportunities/page',
  '/(app)/calendar/page',
  '/(app)/tasks/page',
  '/(app)/workflows/page',
  '/(app)/marketing/page',
  '/(app)/dialer/page',
  '/(app)/dispo/pipeline/page',
  '/(app)/dispo/deals/page',
  '/(app)/dispo/buyers/page',
  '/(app)/dispo/offers/page',
  '/(app)/dispo/broadcasts/page',
  '/(app)/dispo/tc/page',
  '/(app)/dispo/vendors/page',
  '/(app)/dispo/contacts/page',
  '/(app)/dashboard/page',
  '/(app)/reports/acquisitions/page',
  '/(app)/reports/marketing/page',
  '/(app)/reports/dispositions/page',
  '/(app)/reports/finance/page',
  '/(app)/reports/call-sms/page',
  '/(app)/settings/page',
  '/api/ai/command/route',
  '/api/workflows/phone-system/route',
  '/api/workflows/summary/route',
];

for (const route of requiredRoutes) {
  assert(routes.includes(route), `Route integrity failed: missing ${route}`);
}

const appPages = routes.filter((r) => r.startsWith('/(app)/') && r.endsWith('/page'));
const dispoPages = routes.filter((r) => r.startsWith('/(app)/dispo/') && r.endsWith('/page'));

assert(
  appPages.length >= 18,
  `Route integrity failed: expected at least 18 app pages, found ${appPages.length}.`
);

assert(
  dispoPages.length >= 5,
  `Route integrity failed: expected at least 5 dispo pages, found ${dispoPages.length}.`
);

console.log('Route integrity passed:', {
  appPages: appPages.length,
  dispoPages: dispoPages.length,
  sampleRequired: requiredRoutes,
});
