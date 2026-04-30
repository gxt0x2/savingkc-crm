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

const [, payloadPart] = body.token.split('.');
assert(payloadPart, 'Twilio health failed: token was not a JWT.');

const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
const voiceGrant = payload?.grants?.voice;
const outgoingAppSid = voiceGrant?.outgoing?.application_sid;

function assertCleanSid(value, label, prefix) {
  assert(typeof value === 'string' && value.startsWith(prefix), `Twilio health failed: ${label} missing or malformed.`);
  assert(!/\s/.test(value) && !/\\[rnt]/.test(value), `Twilio health failed: ${label} contains newline/whitespace characters.`);
}

assertCleanSid(payload.sub, 'JWT account SID claim', 'AC');
assertCleanSid(payload.iss, 'JWT API key issuer', 'SK');
assertCleanSid(outgoingAppSid, 'Voice application SID', 'AP');
if (body.twimlAppSid) assertCleanSid(body.twimlAppSid, 'response TwiML application SID', 'AP');
assert(payload?.grants?.identity === body.identity, 'Twilio health failed: JWT identity does not match response identity.');

console.log('Twilio token health passed:', {
  url,
  identity: body.identity,
  callerId: body.callerId,
  twimlAppSid: outgoingAppSid,
});
