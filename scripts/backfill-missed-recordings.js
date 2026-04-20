/**
 * Find every Twilio recording from the last 30 days whose call came in
 * through the telephony-bar/heir-dialer but never got transcribed (parent-leg
 * lookup failed + 401 proxy gate). For each, run the full intelligence
 * pipeline and mirror the mapping that `/api/twilio-recording-callback`
 * now performs for live calls.
 */
const { writeFileSync, readFileSync, mkdirSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
{
  const envPath = join(__dirname, '..', '.env.local');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const ACCT = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const GROQ = process.env.GROQ_API_KEY;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const tw = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: ACCT });

async function download(recordingSid) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Recordings/${recordingSid}.mp3`;
  const auth = Buffer.from(`${ACCT}:${TOKEN}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(tmpdir(), 'savingkc-recordings');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${recordingSid}.mp3`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length, url };
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
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (Array.isArray(j.segments)) return j.segments.map(s => s.text?.trim()).filter(Boolean).join(' ');
  return j.text || '';
}

async function analyze(transcript) {
  const prompt = `You are an expert real estate wholesaling call analyst for Saving KC Homebuyers in Kansas City. Analyze this seller call transcript and extract structured intelligence.

TRANSCRIPT:
${transcript.slice(0, 12000)}

Respond in JSON with:
{
  "aiSummary": "3-5 sentence summary",
  "sentiment": "positive | neutral | negative",
  "motivationScore": 1-10,
  "rapportLevel": "low | medium | high",
  "verbatimQuotes": ["up to 5"],
  "objectionsRaised": ["..."],
  "keyLeverage": ["..."],
  "emotionalDrivers": ["..."],
  "personalityType": "accommodator | assertive | analyst",
  "communicationStyle": "...",
  "decisionStyle": "...",
  "situationType": ["inherited | tax_delinquent | vacant | divorce | relocation | repairs_needed | financial_distress"],
  "motivationSignals": ["..."],
  "urgency": "low | medium | high | critical",
  "sellerAsking": null or number,
  "sellerFloor": null or number,
  "priceFlexibility": "none | low | medium | high",
  "priceAnchor": "...",
  "conditionOverall": "excellent | good | fair | poor | uninhabitable",
  "repairsNotes": "...",
  "vacant": true/false,
  "occupancy": "owner | tenant | vacant",
  "hardDeadline": true/false,
  "deadlineReason": "...",
  "targetCloseDate": "...",
  "outOfState": true/false,
  "coOwners": ["..."],
  "blockers": ["..."],
  "followUpAction": "...",
  "followUpDateTime": "...",
  "dealConfidenceScore": 1-100,
  "isHotLead": true/false,
  "opportunity_score": 0-100,
  "classification": "opportunity | lead | dead",
  "nextSteps": ["..."]
}
Be specific. Use actual numbers and quotes. Don't invent data.`;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`analyze ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

async function resolveLeadId(parentCallSid) {
  const children = await tw.calls.list({ parentCallSid, limit: 5 });
  for (const child of children) {
    if (!child.to) continue;
    const phone = child.to.replace(/[^\d+]/g, '');
    const { data } = await sb.from('leads').select('id, full_name').eq('phone', phone).limit(1).maybeSingle();
    if (data?.id) return { leadId: data.id, name: data.full_name, phone };
  }
  return null;
}

function applyFullMapping(manifest, analysis, transcript, duration, recordingSid, recordingUrl, callDate) {
  if (!manifest.communications) manifest.communications = { transcripts: [] };
  manifest.communications.transcripts.push({
    id: `call-${recordingSid}`,
    date: callDate,
    duration,
    agent: 'Casey',
    recordingUrl,
    fullTranscript: transcript,
    aiSummary: analysis?.aiSummary || null,
    extractedData: analysis ? {
      motivationScore: analysis.motivationScore,
      sentiment: analysis.sentiment,
      rapportLevel: analysis.rapportLevel,
      verbatimQuotes: analysis.verbatimQuotes,
      painPoints: [...(analysis.keyLeverage || []), ...(analysis.emotionalDrivers || [])].filter(Boolean),
    } : null,
  });
  if (!analysis) return;

  if (!manifest.ariIntelligence) manifest.ariIntelligence = {};
  if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {};
  if (analysis.personalityType) manifest.ariIntelligence.sellerProfile.personalityType = analysis.personalityType;
  if (analysis.communicationStyle) manifest.ariIntelligence.sellerProfile.communicationStyle = analysis.communicationStyle;
  if (analysis.decisionStyle) manifest.ariIntelligence.sellerProfile.decisionStyle = analysis.decisionStyle;
  if (analysis.emotionalDrivers?.length) manifest.ariIntelligence.sellerProfile.emotionalDrivers = analysis.emotionalDrivers;

  if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {};
  if (analysis.keyLeverage?.length) manifest.ariIntelligence.dealIntelligence.keyLeverage = analysis.keyLeverage;
  if (analysis.dealConfidenceScore != null) manifest.ariIntelligence.dealIntelligence.confidenceScore = analysis.dealConfidenceScore;

  if (!manifest.situation) manifest.situation = {};
  if (analysis.objectionsRaised?.length) {
    if (!manifest.situation.objections) manifest.situation.objections = [];
    for (const o of analysis.objectionsRaised) if (!manifest.situation.objections.includes(o)) manifest.situation.objections.push(o);
  }
  if (analysis.blockers?.length) {
    if (!manifest.situation.blockers) manifest.situation.blockers = [];
    for (const b of analysis.blockers) if (!manifest.situation.blockers.includes(b)) manifest.situation.blockers.push(b);
  }
  if (analysis.situationType?.length) {
    if (!manifest.situation.type) manifest.situation.type = [];
    for (const t of analysis.situationType) if (!manifest.situation.type.includes(t)) manifest.situation.type.push(t);
  }

  if (!manifest.situation.motivation) manifest.situation.motivation = {};
  if (analysis.urgency) manifest.situation.motivation.urgencyLevel = analysis.urgency;
  if (analysis.motivationScore) manifest.situation.motivation.score = analysis.motivationScore;
  if (analysis.motivationSignals?.length) {
    const existing = manifest.situation.motivation.signals || [];
    for (const s of analysis.motivationSignals) if (!existing.includes(s)) existing.push(s);
    manifest.situation.motivation.signals = existing;
  }
  if (analysis.emotionalDrivers?.length) manifest.situation.motivation.emotionalDrivers = analysis.emotionalDrivers;

  if (!manifest.situation.timeline) manifest.situation.timeline = {};
  if (analysis.targetCloseDate) manifest.situation.timeline.preferredClosing = analysis.targetCloseDate;
  if (analysis.hardDeadline !== undefined) manifest.situation.timeline.hardDeadline = analysis.hardDeadline;
  if (analysis.deadlineReason) manifest.situation.timeline.deadlineReason = analysis.deadlineReason;
  if (analysis.urgency) {
    manifest.situation.timeline.flexibility =
      analysis.urgency === 'critical' || analysis.urgency === 'high' ? 'tight' :
      analysis.urgency === 'medium' ? 'moderate' : 'flexible';
  }

  if (!manifest.situation.priceExpectations) manifest.situation.priceExpectations = {};
  if (analysis.sellerAsking != null) manifest.situation.priceExpectations.sellerAsking = analysis.sellerAsking;
  if (analysis.sellerFloor != null) manifest.situation.priceExpectations.sellerFloor = analysis.sellerFloor;
  if (analysis.priceFlexibility) manifest.situation.priceExpectations.flexibility = analysis.priceFlexibility;
  if (analysis.priceAnchor) manifest.situation.priceExpectations.anchor = analysis.priceAnchor;

  if (!manifest.owner) manifest.owner = {};
  if (analysis.outOfState) manifest.owner.outOfState = true;
  if (analysis.coOwners?.length) manifest.owner.coOwners = analysis.coOwners;

  if (!manifest.property) manifest.property = {};
  if (!manifest.property.condition) manifest.property.condition = {};
  if (analysis.conditionOverall) manifest.property.condition.overall = analysis.conditionOverall;
  if (analysis.repairsNotes) manifest.property.condition.repairsNotes = analysis.repairsNotes;
  if (analysis.vacant === true) manifest.property.vacant = true;

  if (analysis.followUpAction) {
    if (!manifest.ariIntelligence.recommendedActions) manifest.ariIntelligence.recommendedActions = [];
    manifest.ariIntelligence.recommendedActions.unshift({
      action: analysis.followUpAction, reason: 'transcript_analysis', when: analysis.followUpDateTime || null,
    });
  }

  manifest.ariIntelligence.briefingStale = true;

  if (!manifest.auditTrail) manifest.auditTrail = [];
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:retroactive_backfill',
    action: 'transcript_added',
    details: { recordingSid, duration, transcriptLength: transcript.length, hasAnalysis: !!analysis },
  });
}

async function processRecording({ sid, callSid, duration, dateCreated }) {
  console.log(`\n=== ${sid} (${duration}s, ${dateCreated}) ===`);

  // Idempotency: skip if manifest already has this transcript
  const target = await resolveLeadId(callSid);
  if (!target) { console.log('  no lead match, skipping'); return; }
  console.log(`  lead: ${target.name} (${target.leadId.slice(0, 8)}…) phone=${target.phone}`);

  const { data: existing } = await sb.from('manifests').select('manifest').eq('lead_id', target.leadId).maybeSingle();
  if (existing?.manifest?.communications?.transcripts?.some(t => t.id === `call-${sid}`)) {
    console.log('  already has this transcript — will REPLACE to pick up new mapping');
    const m = existing.manifest;
    m.communications.transcripts = m.communications.transcripts.filter(t => t.id !== `call-${sid}`);
    await sb.from('manifests').update({ manifest: m }).eq('lead_id', target.leadId);
  }

  const { path, bytes, url } = await download(sid);
  console.log(`  downloaded ${bytes} bytes`);
  const transcript = await transcribe(path);
  console.log(`  transcript: ${transcript.length} chars`);
  const analysis = await analyze(transcript);
  console.log(`  motivation=${analysis?.motivationScore} urgency=${analysis?.urgency} classification=${analysis?.classification} opp=${analysis?.opportunity_score}`);

  // Write transcript + analysis as notes
  await sb.from('lead_activities').insert({
    lead_id: target.leadId, activity_type: 'note', agent: 'AI',
    description: `Call transcript: ${transcript.slice(0, 500)}${transcript.length > 500 ? '...' : ''}`,
    metadata: { source: 'whisper_transcription', recordingSid: sid, fullTranscript: transcript, duration },
  });
  if (analysis) {
    await sb.from('lead_activities').insert({
      lead_id: target.leadId, activity_type: 'note', agent: 'AI',
      description: `AI Call Analysis: ${analysis.aiSummary || 'Analysis complete'}`,
      metadata: { source: 'call_analysis', analysis },
    });
  }

  // Update lead row
  const leadUpdates = { transcript, call_duration_seconds: duration, updated_at: new Date().toISOString() };
  if (analysis?.motivationScore) leadUpdates.motivation_score = analysis.motivationScore;
  if (analysis?.conditionOverall) leadUpdates.property_condition = analysis.conditionOverall;
  if (analysis?.sellerAsking) leadUpdates.asking_price = analysis.sellerAsking;
  if (typeof analysis?.opportunity_score === 'number') leadUpdates.opportunity_score = analysis.opportunity_score;
  if (analysis?.classification) leadUpdates.classification = analysis.classification;
  await sb.from('leads').update(leadUpdates).eq('id', target.leadId);

  // Apply full manifest mapping
  const { data: manRow } = await sb.from('manifests').select('manifest').eq('lead_id', target.leadId).single();
  const m = manRow.manifest || {};
  applyFullMapping(m, analysis, transcript, duration, sid, url, dateCreated);
  await sb.from('manifests').update({ manifest: m, updated_at: new Date().toISOString() }).eq('lead_id', target.leadId);

  console.log(`  DONE — manifest transcripts: ${m.communications.transcripts.length}`);
}

async function triggerBriefingRegen(leadIds) {
  // Prod is still pre-fix, but briefing-regen is idempotent & auth-gated on
  // client cookie; the component fetches on page view anyway once briefingStale=true.
  // We just need to make sure briefingStale is set (done by applyFullMapping).
  console.log(`\nBriefing regeneration will fire on next page view for these leads:`);
  for (const id of leadIds) console.log(`  https://crm.savingkc.com/leads/${id}`);
}

(async () => {
  // 14-day window captures all missed recordings from the telephony-bar era
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const recs = await tw.recordings.list({ dateCreatedAfter: since, limit: 200 });
  const eligible = recs.filter(r => parseInt(r.duration || '0') >= 60);
  console.log(`Eligible recordings (>=60s in last 14d): ${eligible.length}`);

  const touched = new Set();
  for (const r of eligible) {
    try {
      await processRecording({
        sid: r.sid, callSid: r.callSid, duration: parseInt(r.duration),
        dateCreated: r.dateCreated.toISOString(),
      });
      // Track lead_id for briefing regen — discover via the recording's call
      const t = await resolveLeadId(r.callSid);
      if (t?.leadId) touched.add(t.leadId);
    } catch (e) {
      console.error(`  FAILED ${r.sid}:`, e.message);
    }
  }
  await triggerBriefingRegen([...touched]);
  console.log(`\nALL DONE. Leads updated: ${touched.size}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
