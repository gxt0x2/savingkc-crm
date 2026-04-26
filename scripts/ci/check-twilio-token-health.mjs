const baseUrl = (process.env.TWILIO_HEALTH_BASE_URL || 'https://crm.savingkc.com').replace(/\/$/, '');
const url = `${baseUrl}/api/twilio-token`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const res = await fetch(url, {
  headers: {
    Accept: 'application/json',
    ...(process.env.TWILIO_HEALTH_BEARER
      ? { Authorization: `Bearer ${process.env.TWILIO_HEALTH_BEARER}` }
      : {}),
  },
});

assert(res.ok, `Twilio health failed: ${url} returned HTTP ${res.status}.`);

const body = await res.json().catch(() => null);
assert(body && typeof body === 'object', 'Twilio health failed: response was not valid JSON.');
assert(typeof body.token === 'string' && body.token.length > 20, 'Twilio health failed: missing token payload.');
assert(typeof body.callerId === 'string' && body.callerId.startsWith('+1'), 'Twilio health failed: callerId missing or malformed.');
assert(typeof body.identity === 'string' && body.identity.length > 0, 'Twilio health failed: identity missing.');

console.log('Twilio token health passed:', {
  url,
  identity: body.identity,
  callerId: body.callerId,
});
