import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), '.next/server/app-paths-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const routes = Object.keys(manifest);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredRoutes = [
  '/(app)/ari/page',
  '/(app)/leads/page',
  '/(app)/dialer/page',
  '/(app)/dispo/pipeline/page',
];

for (const route of requiredRoutes) {
  assert(routes.includes(route), `Route integrity failed: missing ${route}`);
}

const appPages = routes.filter((r) => r.startsWith('/(app)/') && r.endsWith('/page'));
const dispoPages = routes.filter((r) => r.startsWith('/(app)/dispo/') && r.endsWith('/page'));

assert(
  appPages.length >= 12,
  `Route integrity failed: expected at least 12 app pages, found ${appPages.length}.`
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
