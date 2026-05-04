const baseUrl = (process.env.EDGE_INTEGRITY_BASE_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
const healthBearer = process.env.TWILIO_HEALTH_BEARER

const expectVercel = envBool('EDGE_EXPECT_VERCEL', true)
const expectCloudflare = envBool('EDGE_EXPECT_CLOUDFLARE', false)

function envBool(name, defaultValue) {
  const value = process.env[name]
  if (value == null || value === '') return defaultValue
  return /^(1|true|yes|on)$/i.test(value.trim())
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function header(headers, name) {
  return headers.get(name) || ''
}

function assertEdgeHeaders(label, headers) {
  if (expectVercel) {
    assert(
      Boolean(header(headers, 'x-vercel-id')),
      `${label}: missing x-vercel-id header (request is not clearly serving from Vercel edge)`
    )
  }

  if (expectCloudflare) {
    assert(
      Boolean(header(headers, 'cf-ray')),
      `${label}: missing cf-ray header (Cloudflare proxy is not clearly active)`
    )
    const cfCache = header(headers, 'cf-cache-status').toUpperCase()
    assert(Boolean(cfCache), `${label}: missing cf-cache-status header`)
    assert(cfCache !== 'HIT', `${label}: cf-cache-status=HIT for dynamic endpoint (should be DYNAMIC/BYPASS/MISS)`)
  }
}

function assertNoStore(label, headers) {
  const cacheControl = header(headers, 'cache-control').toLowerCase()
  const cdnCache = header(headers, 'cdn-cache-control').toLowerCase()
  const cfCdnCache = header(headers, 'cloudflare-cdn-cache-control').toLowerCase()

  assert(
    cacheControl.includes('no-store'),
    `${label}: cache-control must include no-store. got "${cacheControl || 'missing'}"`
  )

  assert(
    cdnCache.includes('no-store'),
    `${label}: cdn-cache-control must include no-store. got "${cdnCache || 'missing'}"`
  )

  // Cloudflare may strip Cloudflare-CDN-Cache-Control at the final edge response.
  // If present, enforce no-store; if absent, treat it as informational.
  if (cfCdnCache) {
    assert(
      cfCdnCache.includes('no-store'),
      `${label}: cloudflare-cdn-cache-control must include no-store when present. got "${cfCdnCache}"`
    )
  }
}

async function fetchChecked(url, init, label) {
  const res = await fetch(url, init)
  assert(res.ok, `${label}: expected HTTP 2xx, got ${res.status}`)
  return res
}

async function checkDialerPage() {
  const url = `${baseUrl}/dialer`
  const res = await fetchChecked(url, { method: 'GET', redirect: 'follow' }, 'dialer page')
  assertEdgeHeaders('dialer page', res.headers)

  const html = await res.text()
  assert(
    /Dialer/i.test(html),
    'dialer page: expected response HTML to include "Dialer"'
  )

  return {
    status: res.status,
    cacheControl: header(res.headers, 'cache-control'),
    vercelId: header(res.headers, 'x-vercel-id'),
    cfCacheStatus: header(res.headers, 'cf-cache-status') || null,
  }
}

async function checkTwilioToken() {
  const url = `${baseUrl}/api/twilio-token`
  const res = await fetchChecked(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(healthBearer ? { Authorization: `Bearer ${healthBearer}` } : {}),
      },
    },
    'twilio-token endpoint'
  )

  assertEdgeHeaders('twilio-token endpoint', res.headers)
  assertNoStore('twilio-token endpoint', res.headers)

  const body = await res.json().catch(() => null)
  assert(body && typeof body === 'object', 'twilio-token endpoint: response is not valid JSON')
  assert(typeof body.token === 'string' && body.token.length > 20, 'twilio-token endpoint: missing token payload')
  assert(typeof body.identity === 'string' && body.identity.length > 0, 'twilio-token endpoint: missing identity')
  assert(typeof body.callerId === 'string' && body.callerId.startsWith('+1'), 'twilio-token endpoint: malformed callerId')

  return {
    status: res.status,
    identity: body.identity,
    callerId: body.callerId,
    cacheControl: header(res.headers, 'cache-control'),
    cdnCacheControl: header(res.headers, 'cdn-cache-control'),
    cloudflareCdnCacheControl: header(res.headers, 'cloudflare-cdn-cache-control'),
  }
}

async function checkTwimlVoice() {
  const url = `${baseUrl}/api/twiml-voice`
  const params = new URLSearchParams({
    To: '+18162262552',
    From: 'client:ernest',
    CallerId: '+18166088588',
  })

  const res = await fetchChecked(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    'twiml-voice endpoint'
  )

  assertEdgeHeaders('twiml-voice endpoint', res.headers)
  assertNoStore('twiml-voice endpoint', res.headers)

  const twiml = await res.text()
  assert(/<Dial\b/i.test(twiml), 'twiml-voice endpoint: missing <Dial> in TwiML response')
  assert(/<Number>\+18162262552<\/Number>/i.test(twiml), 'twiml-voice endpoint: destination number mismatch')

  return {
    status: res.status,
    cacheControl: header(res.headers, 'cache-control'),
    cdnCacheControl: header(res.headers, 'cdn-cache-control'),
    cloudflareCdnCacheControl: header(res.headers, 'cloudflare-cdn-cache-control'),
  }
}

async function main() {
  const started = Date.now()
  const [dialer, token, twiml] = await Promise.all([
    checkDialerPage(),
    checkTwilioToken(),
    checkTwimlVoice(),
  ])

  console.log('Edge integrity gate passed:', {
    baseUrl,
    expectVercel,
    expectCloudflare,
    elapsedMs: Date.now() - started,
    dialer,
    twilioToken: token,
    twimlVoice: twiml,
  })
}

main().catch((error) => {
  console.error('Edge integrity gate failed:', error?.message || error)
  process.exit(1)
})
