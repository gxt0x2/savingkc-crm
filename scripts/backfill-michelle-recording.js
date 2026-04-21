/**
 * One-off backfill: re-run the recording-callback pipeline for Michelle Said's
 * 25-min call from 2026-04-20. The live callback was dropping this (and
 * every other outbound WebRTC call) because the proxy middleware was
 * returning 401 and the parent-leg lead lookup had no phone to match against.
 *
 * This script replays the pipeline locally using .env.local credentials so we
 * can verify the fix on a real recording without waiting for PR #17 to merge.
 */
// Load .env.local without requiring the dotenv package (not in deps)
const { writeFileSync, readFileSync, mkdirSync } = require('fs');
{
  const envPath = require('path').join(__dirname, '..', '.env.local');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const { tmpdir } = require('os');
const { join } = require('path');
const { createClient } = require('@supabase/supabase-js');

const LEAD_ID = '05a7f142-3278-42e3-b87f-2ef87094856f';
const RECORDING_SID = 'REc8495545b4dd2b11938448e51c89d0e0';
const CALL_SID = 'CA91080ff30b94628650043d85f72795d8';
const DURATION = 1521;
const ACCT = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GROQ = process.env.GROQ_API_KEY;
const RECORDING_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Recordings/${RECORDING_SID}.mp3`;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function downloadRecording() {
  const auth = Buffer.from(`${ACCT}:${TOKEN}`).toString('base64');
  const res = await fetch(RECORDING_URL, { headers: { Authorization: `Basic ${auth}` }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(tmpdir(), 'savingkc-recordings');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${RECORDING_SID}.mp3`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length };
}

async function transcribe(path) {
  const audio = readFileSync(path);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'recording.mp3');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${GROQ}` }, body: form,
  });
  if (!res.ok) throw new Error(`Groq Whisper ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (Array.isArray(j.segments)) {
    return j.segments.map(s => s.text?.trim()).filter(Boolean).join(' ');
  }
  return j.text || '';
}

async function analyze(transcript) {
  const prompt = `You are an expert real estate wholesaling call analyst for Saving KC Homebuyers in Kansas City. Analyze this seller call transcript and extract structured intelligence.

TRANSCRIPT:
${transcript.slice(0, 12000)}

Respond in JSON with these fields (skip any field where there's no data):
{
  "aiSummary": "3-5 sentence summary of the call",
  "sentiment": "positive | neutral | negative",
  "motivationScore": 1-10,
  "rapportLevel": "low | medium | high",
  "verbatimQuotes": ["up to 5 exact quotes"],
  "objectionsRaised": ["..."],
  "keyLeverage": ["..."],
  "emotionalDrivers": ["..."],
  "personalityType": "accommodator | assertive | analyst",
  "communicationStyle": "...",
  "situationType": ["inherited | tax_delinquent | vacant | divorce | relocation | repairs_needed | financial_distress"],
  "urgency": "low | medium | high | critical",
  "sellerAsking": null or number,
  "priceFlexibility": "none | low | medium | high",
  "conditionOverall": "excellent | good | fair | poor | uninhabitable",
  "vacant": true/false,
  "occupancy": "owner | tenant | vacant",
  "hardDeadline": true/false,
  "targetCloseDate": "...",
  "followUpAction": "...",
  "dealConfidenceScore": 1-100,
  "isHotLead": true/false,
  "opportunity_score": 0-100,
  "classification": "opportunity | lead | dead",
  "nextSteps": ["..."]
}
Be specific. Use actual numbers and quotes from the transcript. Don't make up data.`;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`Groq analyze ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}

(async () => {
  console.log('[backfill] downloading recording from Twilio…');
  const { path, bytes } = await downloadRecording();
  console.log(`  -> ${path} (${bytes} bytes)`);

  console.log('[backfill] transcribing with Groq Whisper…');
  const transcript = await transcribe(path);
  console.log(`  -> ${transcript.length} chars`);
  console.log(`  head: ${transcript.slice(0, 140)}…`);

  console.log('[backfill] analyzing transcript…');
  const analysis = await analyze(transcript);
  console.log('  summary:', analysis?.aiSummary);
  console.log('  motivationScore:', analysis?.motivationScore, '  urgency:', analysis?.urgency, '  classification:', analysis?.classification);

  // 1. Insert transcript activity
  await sb.from('lead_activities').insert({
    lead_id: LEAD_ID, activity_type: 'note', agent: 'AI',
    description: `Call transcript: ${transcript.slice(0, 500)}${transcript.length > 500 ? '...' : ''}`,
    metadata: { source: 'whisper_transcription', recordingSid: RECORDING_SID, fullTranscript: transcript, duration: DURATION },
  });

  // 2. Insert AI analysis activity
  if (analysis) {
    await sb.from('lead_activities').insert({
      lead_id: LEAD_ID, activity_type: 'note', agent: 'AI',
      description: `AI Call Analysis: ${analysis.aiSummary || 'Analysis complete'}`,
      metadata: { source: 'call_analysis', analysis },
    });
  }

  // 3. Update lead row denormalized fields
  const leadUpdates = { transcript, call_duration_seconds: DURATION, updated_at: new Date().toISOString() };
  if (analysis?.motivationScore) leadUpdates.motivation_score = analysis.motivationScore;
  if (analysis?.conditionOverall) leadUpdates.property_condition = analysis.conditionOverall;
  await sb.from('leads').update(leadUpdates).eq('id', LEAD_ID);
  console.log('[backfill] updated lead row with', Object.keys(leadUpdates).join(', '));

  // 4. Update manifest
  const { data: manRow } = await sb.from('manifests').select('*').eq('lead_id', LEAD_ID).single();
  const m = manRow.manifest || {};
  if (!m.communications) m.communications = { transcripts: [] };
  m.communications.transcripts.push({
    id: `call-${RECORDING_SID}`,
    date: '2026-04-20T18:24:05.188Z',
    duration: DURATION,
    agent: 'Casey',
    recordingUrl: RECORDING_URL,
    fullTranscript: transcript,
    aiSummary: analysis?.aiSummary || null,
    extractedData: analysis ? {
      motivationScore: analysis.motivationScore,
      sentiment: analysis.sentiment,
      rapportLevel: analysis.rapportLevel,
      verbatimQuotes: analysis.verbatimQuotes,
    } : null,
  });
  if (analysis?.personalityType || analysis?.communicationStyle) {
    if (!m.ariIntelligence) m.ariIntelligence = {};
    if (!m.ariIntelligence.sellerProfile) m.ariIntelligence.sellerProfile = {};
    if (analysis.personalityType) m.ariIntelligence.sellerProfile.personalityType = analysis.personalityType;
    if (analysis.communicationStyle) m.ariIntelligence.sellerProfile.communicationStyle = analysis.communicationStyle;
  }
  if (analysis?.keyLeverage?.length) {
    if (!m.ariIntelligence) m.ariIntelligence = {};
    if (!m.ariIntelligence.dealIntelligence) m.ariIntelligence.dealIntelligence = {};
    m.ariIntelligence.dealIntelligence.keyLeverage = analysis.keyLeverage;
  }
  if (analysis?.objectionsRaised?.length) {
    if (!m.situation) m.situation = {};
    if (!m.situation.objections) m.situation.objections = [];
    for (const o of analysis.objectionsRaised) {
      if (!m.situation.objections.includes(o)) m.situation.objections.push(o);
    }
  }
  if (!m.auditTrail) m.auditTrail = [];
  m.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:retroactive_backfill',
    action: 'transcript_added',
    details: { recordingSid: RECORDING_SID, duration: DURATION, transcriptLength: transcript.length },
  });
  if (!m.ariIntelligence) m.ariIntelligence = {};
  m.ariIntelligence.briefingStale = true;

  await sb.from('manifests').update({ manifest: m, updated_at: new Date().toISOString() }).eq('lead_id', LEAD_ID);
  console.log('[backfill] manifest transcripts count now:', m.communications.transcripts.length);

  console.log('\n[backfill] DONE');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
