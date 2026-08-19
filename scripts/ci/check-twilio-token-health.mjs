const baseUrl = (process.env.TWILIO_HEALTH_BASE_URL || 'https://crm.savingkc.com').replace(/\/$/, '');
const url = `${baseUrl}/api/twilio-token`;
const healthBearer = process.env.TWILIO_HEALTH_BEARER;
const MAX_ATTEMPTS = 6;
const RETRY_MS = 20_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  Boolean(healthBearer),
  'Twilio health failed: TWILIO_HEALTH_BEARER is required for protected CRM health checks.'
);

let res;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${healthBearer}`,
    },
  });

  if (res.status === 401 || attempt === MAX_ATTEMPTS) break;

  // A main-branch workflow can finish before the corresponding Vercel
  // production deployment is promoted. Retry briefly without logging bodies.
  console.log(`Twilio containment not deployed yet (HTTP ${res.status}); retrying ${attempt}/${MAX_ATTEMPTS}.`);
  await res.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
}

assert(
  res.status === 401,
  `Twilio containment failed: health bearer must receive HTTP 401 from ${url}; got ${res.status}.`
);

const body = await res.json().catch(() => null);
assert(body && typeof body === 'object', 'Twilio containment failed: response was not valid JSON.');
assert(body.error === 'Unauthorized', 'Twilio containment failed: expected an Unauthorized response.');
assert(!Object.prototype.hasOwnProperty.call(body, 'token'), 'Twilio containment failed: unauthorized response exposed a token.');

const cacheControl = res.headers.get('cache-control') || '';
assert(cacheControl.toLowerCase().includes('no-store'), 'Twilio containment failed: unauthorized response must be no-store.');

console.log('Twilio token containment passed:', {
  url,
  status: res.status,
  tokenExposed: false,
  cacheControl,
});
