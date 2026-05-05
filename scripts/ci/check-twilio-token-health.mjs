const baseUrl = (process.env.TWILIO_HEALTH_BASE_URL || 'https://crm.savingkc.com').replace(/\/$/, '');
const url = `${baseUrl}/api/twilio-token`;
const twilioSidPattern = /^[A-Z]{2}[0-9a-fA-F]{32}$/;
const healthBearer = process.env.TWILIO_HEALTH_BEARER;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  Boolean(healthBearer),
  'Twilio health failed: TWILIO_HEALTH_BEARER is required for protected CRM health checks.'
);

function decodeJwtPart(token, index, label) {
  const parts = token.split('.');
  assert(parts.length === 3, 'Twilio health failed: token is not a JWT.');

  try {
    return JSON.parse(Buffer.from(parts[index], 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Twilio health failed: token ${label} was not valid JSON.`);
  }
}

function assertSid(value, prefix, label) {
  assert(typeof value === 'string', `Twilio health failed: ${label} missing.`);
  assert(!/\s/.test(value), `Twilio health failed: ${label} contains whitespace.`);
  assert(value.startsWith(prefix), `Twilio health failed: ${label} must start with ${prefix}.`);
  assert(twilioSidPattern.test(value), `Twilio health failed: ${label} is malformed.`);
}

const res = await fetch(url, {
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${healthBearer}`,
  },
});

assert(res.ok, `Twilio health failed: ${url} returned HTTP ${res.status}.`);

const body = await res.json().catch(() => null);
assert(body && typeof body === 'object', 'Twilio health failed: response was not valid JSON.');
assert(typeof body.token === 'string' && body.token.length > 20, 'Twilio health failed: missing token payload.');
assert(typeof body.callerId === 'string' && body.callerId.startsWith('+1'), 'Twilio health failed: callerId missing or malformed.');
assert(typeof body.identity === 'string' && body.identity.length > 0, 'Twilio health failed: identity missing.');

const cacheControl = res.headers.get('cache-control') || '';
assert(cacheControl.toLowerCase().includes('no-store'), 'Twilio health failed: token response must be no-store.');

const header = decodeJwtPart(body.token, 0, 'header');
const payload = decodeJwtPart(body.token, 1, 'payload');

assert(header.typ === 'JWT', 'Twilio health failed: token header typ must be JWT.');
assert(payload.grants && typeof payload.grants === 'object', 'Twilio health failed: token grants missing.');
assert(payload.grants.identity === body.identity, 'Twilio health failed: token identity does not match response identity.');
assertSid(payload.sub, 'AC', 'Account SID claim');
assertSid(payload.iss, 'SK', 'API Key issuer claim');
assert(Number.isInteger(payload.iat), 'Twilio health failed: token issued-at claim missing.');
assert(Number.isInteger(payload.exp), 'Twilio health failed: token expiration claim missing.');
assert(payload.exp > payload.iat, 'Twilio health failed: token expiration is not after issued-at.');
assert(payload.exp - payload.iat <= 3600, 'Twilio health failed: token TTL is longer than expected.');

const voiceGrant = payload.grants.voice;
assert(voiceGrant && typeof voiceGrant === 'object', 'Twilio health failed: Voice grant missing.');
assert(voiceGrant.incoming?.allow === true, 'Twilio health failed: incoming Voice grant missing.');
assertSid(voiceGrant.outgoing?.application_sid, 'AP', 'TwiML App SID grant');

console.log('Twilio token health passed:', {
  url,
  identity: body.identity,
  callerId: body.callerId,
  accountSidLength: payload.sub.length,
  issuerSidLength: payload.iss.length,
  ttlSeconds: payload.exp - payload.iat,
  twimlAppSidPrefix: voiceGrant.outgoing.application_sid.slice(0, 4),
});
