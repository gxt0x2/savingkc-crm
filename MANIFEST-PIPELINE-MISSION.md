# MISSION: Manifest Pipeline — Full Repair + Prospect Data Import
**Saving KC Homebuyers LLC — crm.savingkc.com**
**Repo:** github.com/gxt0x2/savingkc-crm (branch: main)
**Stack:** Next.js 16 / React 19 / Supabase / Twilio / PM2 on Mac Mini
**Date:** 2026-04-07

---

## MISSION SUMMARY

There are two problems to solve:

**PROBLEM A:** The `prospects` and `prospect_phones` tables do not exist in Supabase. The code references them but they were never created. Two CSV files (`prospects_import.csv` and `prospect_phones_import.csv`) contain 24,482 prospects and 23,910 phone numbers from tax delinquent lists across Jackson, Clay, and Johnson counties. These tables must be created and the data imported.

**PROBLEM B:** The lead creation → manifest → enrichment pipeline has 10 code-level gaps that cause manifests to be created empty, enrichment to never fire, and data to split between the leads table and manifest. All 10 must be fixed.

**CRITICAL:** None of the fixes described below have been applied yet. The current codebase (commit `11e955f`) still has every bug. Do not skip any fix assuming it was already done.

---

## RULES

1. **Surgical fixes only.** Do NOT restructure, rename, or reorganize files.
2. **Keep all existing imports and patterns.**
3. **Test after each phase** — don't batch all changes into one commit.
4. **Read each file before editing** — line numbers may shift after earlier fixes.

---

## PHASE 0: CREATE PROSPECT TABLES + IMPORT DATA

### Step 0a: Create tables in Supabase

Run this SQL in the Supabase SQL Editor (or via migration):

```sql
-- Prospects: one row per property/tax record
CREATE TABLE IF NOT EXISTS prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_id TEXT,
  county TEXT NOT NULL,
  situs_address TEXT,
  situs_street TEXT,
  situs_city TEXT,
  situs_state TEXT,
  situs_zip TEXT,
  owner_1 TEXT,
  owner_1_first TEXT,
  owner_1_last TEXT,
  owner_1_type TEXT,
  mailing_street TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  cumulative_due NUMERIC,
  earliest_delinquent_year INTEGER,
  delinquent_years_category TEXT,
  total_market_value NUMERIC,
  zestimate NUMERIC,
  occupancy_status TEXT,
  is_deceased BOOLEAN DEFAULT FALSE,
  is_skip_traced BOOLEAN DEFAULT FALSE,
  owner_age INTEGER,
  email_1 TEXT,
  email_2 TEXT,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_parcel ON prospects(parcel_id);
CREATE INDEX IF NOT EXISTS idx_prospects_county ON prospects(county);
CREATE INDEX IF NOT EXISTS idx_prospects_lead_id ON prospects(lead_id);
CREATE INDEX IF NOT EXISTS idx_prospects_situs_address ON prospects(situs_street);

-- Prospect phones: one row per phone number, linked to prospect
CREATE TABLE IF NOT EXISTS prospect_phones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  phone_type TEXT,
  phone_connected TEXT,
  contact_name TEXT,
  relationship TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_phones_phone ON prospect_phones(phone);
CREATE INDEX IF NOT EXISTS idx_prospect_phones_prospect ON prospect_phones(prospect_id);
```

### Step 0b: Import CSV data

Two CSV files must be present in the repo root:
- `prospects_import.csv` — 24,482 rows (prospects from Clay, Jackson, Johnson counties)
- `prospect_phones_import.csv` — 23,910 rows (phone numbers linked to prospects)

These files were generated from:
- Clay County: `clay_county_cities_filled_clean__2_.csv` — full BatchSkipTracing export (21 phones per record)
- Jackson County: `Jackson_County_Tax_2026_Winter_-_Filterded__1_.xlsx` — 11 sheets including 4 skip traced sheets
- Johnson County: `Johnson_County_Tax_Delinquent_Jan_2026__1_.xlsx` — 8 sheets including 4 skip traced sheets

Write a Node.js import script (`scripts/import-prospects.mjs`) that:
1. Reads both CSVs
2. Inserts prospects in batches of 500 (handle `None`/`nan` as null, convert numeric strings)
3. Inserts prospect_phones in batches of 500
4. Logs progress and final counts

The script should read Supabase credentials from `~/savingkc-crm/.env.local`:
```javascript
const envContent = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
```

**Verification:** After import, run:
```sql
SELECT count(*) FROM prospects;           -- Should be ~24,482
SELECT count(*) FROM prospect_phones;     -- Should be ~23,910
SELECT count(*) FROM prospect_phones WHERE phone = '+18168063163';  -- Should be 1
```

---

## PHASE 1: DATA FLOW FIXES

These fix WHY manifests are created empty and WHY enrichment never fires.

---

### FIX 1: Add Address Parsing for County Detection

**Problem:** `/api/book` and `/api/leads` POST receive a full address string like "1234 Main St, Kansas City, MO 64101" but enrichment requires separate city/state/zip/county fields. The `detectCounty()` function only accepts those as separate params. When they're missing, enrichment silently skips.

**File:** `src/lib/county-enrichment.ts`

**Action:** Add this function AFTER the existing `detectCounty()` function (currently the last exported function in the file):

```typescript
/**
 * Parse a full address string to extract city, state, zip and detect county.
 * Used when forms send a single address field without separate city/state/zip.
 */
export function parseAddressForCounty(address: string): {
  city?: string; state?: string; zip?: string; county?: string;
} | null {
  if (!address) return null

  let city: string | undefined
  let state: string | undefined
  let zip: string | undefined

  // Match "City, ST 12345" or "City ST 12345" at end of address
  const fullMatch = address.match(/,?\s*([A-Za-z\s]+?),?\s*(MO|KS|mo|ks)\s*(\d{5})?\s*$/)
  if (fullMatch) {
    city = fullMatch[1]?.trim()
    state = fullMatch[2]?.toUpperCase()
    zip = fullMatch[3]
  } else {
    const zipMatch = address.match(/(\d{5})\s*$/)
    if (zipMatch) zip = zipMatch[1]
    const stateMatch = address.match(/\b(MO|KS)\b/i)
    if (stateMatch) state = stateMatch[1].toUpperCase()
  }

  // Fallback: detect known KC metro city names embedded in address
  if (!city) {
    const knownCities = [
      'kansas city', 'independence', 'blue springs', 'raytown',
      'grandview', 'liberty', 'kearney', 'smithville', 'excelsior springs',
      'north kansas city', 'overland park', 'olathe', 'shawnee',
      'lenexa', 'leawood', 'prairie village', 'merriam', 'gardner',
      'bonner springs', 'edwardsville', "lee's summit", 'lees summit',
      'gladstone', 'belton', 'raymore', 'peculiar', 'pleasant hill',
    ]
    const lower = address.toLowerCase()
    for (const c of knownCities) {
      if (lower.includes(c)) { city = c; break }
    }
  }

  const detected = detectCounty(city, state, zip)
  return { city, state: state || detected?.state, zip, county: detected?.county }
}
```

**Then update these three files to use it:**

**File:** `src/app/api/book/route.ts`
Find the enrichment block that starts with `if (manifestData?.id && property_address?.trim())`. Inside that block, the code reads `body.property_city`, `body.property_state`, `body.property_zip`, `body.property_county` — but the /call form never sends those fields. Replace that logic:

```typescript
// After: if (manifestData?.id && property_address?.trim()) {
//   try {
// ADD at the start of the try block:
const { parseAddressForCounty } = await import('@/lib/county-enrichment')
const parsed = parseAddressForCounty(property_address.trim())

const city = body.property_city || parsed?.city
const state = body.property_state || parsed?.state
const zip = body.property_zip || parsed?.zip
let county = body.property_county || parsed?.county

if (!county && (city || state || zip)) {
  const detected = detectCounty(city, state, zip)
  if (detected) county = detected.county
}

// Backfill city/state/zip/county on the lead record
if (leadId && (city || state || zip)) {
  await supabase.from('leads').update({
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zip ? { zip } : {}),
    ...(county ? { county } : {}),
  }).eq('id', leadId)
}
```

**File:** `src/app/api/leads/route.ts` — in the POST handler, before the `supabase.from('leads').insert(...)`, parse the address and include city/state/zip/county in the insert:

```typescript
// Before the insert, add:
let city, state, zip, county
if (address) {
  const { parseAddressForCounty } = await import('@/lib/county-enrichment')
  const parsed = parseAddressForCounty(address)
  if (parsed) { city = parsed.city; state = parsed.state; zip = parsed.zip; county = parsed.county }
}

// Then modify the insert to include:
// ...(city ? { city } : {}),
// ...(state ? { state } : {}),
// ...(zip ? { zip } : {}),
// ...(county ? { county } : {}),
```

**File:** `src/lib/auto-enrich.ts` — in the county enrichment section (around line 54), add a fallback that parses the address when city/state/zip are missing:

```typescript
// Before the county detection logic, add:
if (!lead.county || !lead.state) {
  const { parseAddressForCounty } = await import('./county-enrichment')
  const parsed = parseAddressForCounty(lead.property_address)
  if (parsed) {
    city = city || parsed.city
    state = state || parsed.state
    zip = zip || parsed.zip
    county = county || parsed.county
  }
}
```

---

### FIX 2: Prospect Lookup on ALL Lead Entry Points

**Problem:** Only 2 of 6 lead entry points check the `prospect_phones` table. The other 4 create bare leads, ignoring 23,910 skip-traced phone numbers in the database.

**The pattern to add (adapt source param per entry point):**

```typescript
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect } from '@/lib/prospect-to-lead'

// Before creating a bare lead, check prospects:
const prospectMatches = await lookupProspectByPhone(normalizedPhone)
if (prospectMatches.length > 0) {
  leadId = await createEnrichedLeadFromProspect(
    prospectMatches[0], normalizedPhone, SOURCE, PRIORITY
  )
}
```

**IMPORTANT:** The `createEnrichedLeadFromProspect()` function in `src/lib/prospect-to-lead.ts` currently only accepts source values of `'tax_delinquent_inbound_call'` or `'tax_delinquent_inbound_sms'`. You need to update its type signature to accept additional source values:

```typescript
// In prospect-to-lead.ts, change the source parameter type:
source: 'tax_delinquent_inbound_call' | 'tax_delinquent_inbound_sms' | 'website_form' | 'youtube' | 'inbound_ivr' | 'cold_call_callback' | 'inbound_call',
```

**Files to update:**

1. **`src/app/api/leads/route.ts`** POST handler — after checking `leads` table for existing phone match, add prospect lookup before the bare insert. Source: `source || 'website_form'`, priority: `'warm'`.

2. **`src/app/api/book/route.ts`** — after checking `leads` table for existing phone (around line 82-111), add prospect lookup in the `else` branch before the bare insert. Source: `source === 'youtube' ? 'youtube' : 'website_form'`, priority: `'hot'`.

3. **`src/app/api/ivr/handle-input/route.ts`** — in the press-1 handler, after checking `leads` table (around line 30-48), add prospect lookup in the `else` branch. Source: `isColdCall ? 'cold_call_callback' : 'inbound_ivr'`, priority: `'hot'`.

4. **`src/app/api/twilio-missed-call/route.ts`** — in the unknown caller section (around line 176-184), add prospect lookup before the bare insert. Source: `'inbound_call'`, priority: `'hot'`.

---

### FIX 3: Stop Swallowing Manifest Creation Errors

**Problem:** Multiple files use `.catch(() => {})` which silently eats errors. Replace with actual logging.

**Pattern:** Replace `.catch(() => {})` with `.catch(err => console.error('[MANIFEST] Failed:', err))`

**Files (search each for `.catch(() => {})`):**

1. `src/app/api/leads/route.ts` — `ensureManifestExists(data.id).catch(() => {})`
2. `src/app/api/ivr/no-input/route.ts` — `ensureManifestExists(noInputLeadId).catch(() => {})`
3. `src/app/api/ivr/handle-input/route.ts` — `ensureManifestExists(leadId).catch(() => {})`
4. `src/app/api/ivr/after-record/route.ts` — `ensureManifestExists(leadId).catch(() => {})`
5. `src/app/api/ivr/voicemail-recording/route.ts` — `ensureManifestExists(resolvedLeadId).catch(() => {})`
6. `src/app/api/twilio-missed-call/route.ts` — nested `.catch(() => {})` on lines 197-198
7. `src/app/api/twilio-sms-webhook/route.ts` — nested `.catch(() => {})` around line 513-515
8. `src/lib/prospect-to-lead.ts` — `onCommunicationEvent(...).catch(() => {})`

---

## PHASE 2: CASCADE COMPLIANCE FIXES

These fix split-brain between the `leads` table and the manifest JSONB.

The rule: **ALL writes to manifest-owned fields (station, priority, motivation_score) must go through `updateManifestAndCascade()` from `src/lib/manifest-sync.ts`.** This function updates the manifest, syncs derived fields to the leads table, and fires the Hot Engine event bus.

---

### FIX 5: `pipeline-auto-advance.ts` Bypasses updateManifestAndCascade

**Problem:** Lines 85-150 manually read the manifest, mutate it, write it back to the manifests table, then separately update the leads table. This hand-rolled cascade skips the Hot Engine event bus and has a fallback that writes station directly to leads without touching the manifest.

**File:** `src/lib/pipeline-auto-advance.ts`

**Action:** Replace lines 83-150 (the manifest write + leads sync block) with:

```typescript
const { updateManifestAndCascade } = await import('./manifest-sync')

const cascaded = await updateManifestAndCascade(leadId, (manifest: any) => {
  manifest.currentStation = newStation

  const stageMap: Record<string, string> = {
    contacted: 'qualifying', qualified: 'discovery',
    offer_made: 'offer', under_contract: 'contract', closed: 'closed',
  }
  const manifestStage = stageMap[newStation]
  if (manifestStage && manifest.pipeline?.[manifestStage]) {
    manifest.pipeline[manifestStage].status = 'completed'
    manifest.pipeline[manifestStage].completedAt = new Date().toISOString()
    manifest.pipeline[manifestStage].enteredAt =
      manifest.pipeline[manifestStage].enteredAt || new Date().toISOString()
  }

  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true

  if (!manifest.auditTrail) manifest.auditTrail = []
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:pipeline',
    action: 'station_advanced',
    details: { from: current, to: newStation, trigger },
  })
}, 'system:pipeline')

if (!cascaded) {
  // No manifest exists — fallback to direct leads update
  await supabase.from('leads').update({ station: newStation }).eq('id', leadId)
}
```

---

### FIX 6: `stage-logic.ts` Never Touches Manifests

**Problem:** `advanceLeadStage()` writes station directly to the leads table (around line 494) and priority (around line 546). It has zero awareness of manifests. Manual stage changes from the CRM UI create split-brain.

**File:** `src/lib/stage-logic.ts`

**Action:** After every `.from('leads').update({ station: ... })` call, add a manifest cascade. There are 3 locations:

After the station update (~line 494):
```typescript
try {
  const { updateManifestAndCascade } = await import('./manifest-sync')
  await updateManifestAndCascade(leadId, (manifest: any) => {
    manifest.currentStation = targetStage
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
    if (!manifest.auditTrail) manifest.auditTrail = []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: changedBy,
      action: 'station_changed',
      details: { from: fromStage, to: targetStage, method, reason },
    })
  }, `stage_logic:${method}`)
} catch (err) {
  console.error('[stage-logic] Manifest cascade failed:', err)
}
```

Same pattern after the priority update (~line 546) and station reset (~line 594).

---

### FIX 7: `/api/enrich` Route Bypasses Cascade

**Problem:** The standalone enrichment endpoint (`src/app/api/enrich/route.ts`) writes directly to the manifests table (around line 135), skipping cascade to leads table and Hot Engine.

**File:** `src/app/api/enrich/route.ts`

**Action:** Replace the `updateManifest()` function (the private function, not the route handler) to use `updateManifestAndCascade`:

```typescript
async function updateManifest(manifestId: string, enrichment: any) {
  const { data: row } = await supabase
    .from('manifests').select('lead_id').eq('id', manifestId).single()
  if (!row?.lead_id) throw new Error('Manifest not found or has no lead_id')

  const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
  const cascaded = await updateManifestAndCascade(row.lead_id, (manifest: any) => {
    if (enrichment.appraisedValue || enrichment.assessedValue || enrichment.landValue || enrichment.improvementValue) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: enrichment.appraisedValue || manifest.property.assessment?.totalValue,
        landValue: enrichment.landValue || manifest.property.assessment?.landValue,
        improvementValue: enrichment.improvementValue || manifest.property.assessment?.improvementValue,
      }
    }
    if (enrichment.sqft || enrichment.bedrooms || enrichment.bathrooms || enrichment.yearBuilt) {
      manifest.property.dwelling = {
        ...manifest.property.dwelling,
        sqft: enrichment.sqft || manifest.property.dwelling?.sqft,
        bedrooms: enrichment.bedrooms || manifest.property.dwelling?.bedrooms,
        bathrooms: enrichment.bathrooms || manifest.property.dwelling?.bathrooms,
        yearBuilt: enrichment.yearBuilt || manifest.property.dwelling?.yearBuilt,
        style: enrichment.propertyType || manifest.property.dwelling?.style,
      }
    }
    if (enrichment.parcelId) manifest.property.parcel = enrichment.parcelId
    if (enrichment.taxOwed !== undefined) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector, delinquentAmount: enrichment.taxOwed,
      }
    }
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(), agent: 'system:enrichment',
      action: 'county_enrichment_complete',
      details: { county: enrichment.county, source: enrichment.source, result: 'success' },
    })
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
  }, 'api:enrich')

  if (!cascaded) throw new Error('Manifest cascade failed')
}
```

---

### FIX 8: Two IVR Routes Write to Non-Existent Columns

**Problem:** `/api/ivr/after-record/route.ts` and `/api/ivr/voicemail-recording/route.ts` both write `ai_call_analysis` and `last_call_transcript` directly to the manifests table. These columns DO NOT EXIST in the manifests table schema. The data goes nowhere. Transcripts and AI analysis are silently lost.

**Files:** `src/app/api/ivr/after-record/route.ts` and `src/app/api/ivr/voicemail-recording/route.ts`

**Action:** In both files, find the block that does:
```typescript
await supabase.from('manifests').update({
  ai_call_analysis: analysis,
  last_call_transcript: transcript,
}).eq('id', manifest.id)
```

Replace with:
```typescript
const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
await updateManifestAndCascade(leadId, (manifest: any) => {
  if (!manifest.communications) manifest.communications = { transcripts: [] }
  manifest.communications.transcripts.push({
    id: `call-${Date.now()}`,
    date: new Date().toISOString(),
    duration: 0,
    agent: 'System',
    recordingUrl: null,
    fullTranscript: transcript,
    aiSummary: analysis?.summary || analysis?.aiSummary || null,
    extractedData: analysis ? {
      motivationScore: analysis.motivation_score,
      sentiment: analysis.sentiment,
    } : null,
  })
  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true
}, 'ivr:call_analysis')
```

---

### FIX 9: Ghost Protocol Writes Station Directly to Leads

**Problem:** `src/lib/ghost-protocol-pipeline.ts` writes `station: 'new'` directly to the leads table when recycling a dead lead (around line 465), bypassing the manifest.

**File:** `src/lib/ghost-protocol-pipeline.ts`

**Action:** Replace the direct write at ~line 465 with:

```typescript
try {
  const { updateManifestAndCascade } = await import('./manifest-sync')
  const cascaded = await updateManifestAndCascade(enrollment.lead_id, (manifest: any) => {
    manifest.currentStation = 'new'
    manifest.lastUpdatedBy = 'ghost_protocol:trigger_event'
    if (!manifest.auditTrail) manifest.auditTrail = []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(), agent: 'ghost_protocol',
      action: 'lead_recycled', details: { reason: 'trigger_event_detected' },
    })
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
  }, 'ghost_protocol:recycle')

  if (!cascaded) {
    await supabase.from('leads')
      .update({ station: 'new', source: 'Ghost Protocol - Trigger Event' })
      .eq('id', enrollment.lead_id)
  }
} catch (err) {
  console.error('[ghost-protocol] Manifest cascade failed:', err)
}
```

---

### FIX 10: `manifests/[id]` PATCH Skips Hot Engine

**Problem:** The PATCH route in `src/app/api/manifests/[id]/route.ts` has its own manual cascade (lines ~91-124) that writes to the manifests table and syncs to leads, but never fires the Hot Engine event bus. UI edits (financials, deal math) never trigger opportunity rescoring.

**File:** `src/app/api/manifests/[id]/route.ts`

**Action:** Replace the manual save + cascade block (from `const { data, error } = await supabase.from('manifests').update(...)` through the leads sync) with:

```typescript
const { updateManifestAndCascade } = await import('@/lib/manifest-sync')

const cascaded = await updateManifestAndCascade(leadId, (manifest: any) => {
  // Apply deep merge
  const merged = deepMerge(manifest, manifestUpdates)
  Object.assign(manifest, merged)

  manifest.lastUpdated = new Date().toISOString()
  manifest.lastUpdatedBy = updates.agent || 'system'

  if (!manifest.auditTrail) manifest.auditTrail = []
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: updates.agent || 'system',
    action: updates.action || 'manifest_updated',
    details: updates.details,
  })

  if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
  manifest.ariIntelligence.briefingStale = true
}, updates.agent || 'api:manifests_patch')

if (!cascaded) {
  return NextResponse.json({ error: 'Manifest not found' }, { status: 404 })
}

// Fetch and return updated manifest
const supabase = getSupabase()
const { data: result } = await supabase
  .from('manifests').select('manifest').eq('id', id).single()

return NextResponse.json({ success: true, manifest: result?.manifest })
```

---

## PHASE 3: INFRASTRUCTURE

### FIX 4: Install Playwright Chromium Binary

**Problem:** `src/lib/county-enrichment.ts` uses Playwright for Jackson County MO and Wyandotte County KS scraping. If the Chromium binary isn't installed, enrichment fails silently.

**Action (run on Mac Mini):**
```bash
cd ~/savingkc-crm
npx playwright install chromium
```

**Verify:**
```bash
node -e "const { chromium } = require('playwright'); chromium.launch().then(b => { console.log('Chromium OK'); b.close() })"
```

---

## VERIFICATION

After all phases are complete, run this end-to-end test:

### 1. Delete the test lead
```sql
DELETE FROM leads WHERE phone = '+18168063163';
```

### 2. Create a new lead via the book API
```bash
curl -X POST https://crm.savingkc.com/api/book \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test Lead",
    "phone": "8168063163",
    "property_address": "30 E 52nd St, Kansas City, MO 64112",
    "slot_date": "2026-04-08",
    "slot_time": "10:00:00",
    "slot_datetime": "2026-04-08T15:00:00.000Z",
    "source": "website_form"
  }'
```

### 3. Verify the lead
```sql
SELECT id, full_name, phone, property_address, city, state, zip, county, source
FROM leads WHERE phone = '+18168063163' ORDER BY created_at DESC LIMIT 1;
```

**Expected:** `full_name` = "KRAUS JEFFREY & BOBBI" (not "Test Lead"), `county` = "jackson", `city` populated.

### 4. Verify the manifest
```sql
SELECT
  manifest->'owner'->>'fullName' as owner,
  manifest->'property'->'assessment'->>'totalValue' as market_value,
  manifest->'property'->'taxCollector'->>'delinquentAmount' as tax_owed,
  manifest->'financials'->>'arv' as arv,
  manifest->'flags'->>'opportunityFlags' as flags,
  manifest->'situation'->>'type' as situation
FROM manifests WHERE lead_id = '<LEAD_ID>';
```

**Expected:** Market value ~456260, tax owed ~34056, ARV = zestimate (~676300), flags include `3yr_tax_delinquent`, situation includes `tax_delinquent`.

### 5. Check PM2 logs
```bash
pm2 logs savingkc-crm --lines 100 | grep -iE "prospect|enrich|manifest|county"
```

**Expected:** No `[MANIFEST] Failed` errors. Should see prospect match, enrichment attempt, manifest creation.

---

## FILE REFERENCE

Key files touched by this mission:

| File | Fixes |
|---|---|
| `src/lib/county-enrichment.ts` | FIX 1 (add parseAddressForCounty) |
| `src/app/api/book/route.ts` | FIX 1 (use parser), FIX 2 (prospect lookup) |
| `src/app/api/leads/route.ts` | FIX 1 (use parser), FIX 2 (prospect lookup), FIX 3 (error logging) |
| `src/lib/auto-enrich.ts` | FIX 1 (parser fallback) |
| `src/lib/prospect-to-lead.ts` | FIX 2 (expand source types), FIX 3 (error logging) |
| `src/app/api/ivr/handle-input/route.ts` | FIX 2 (prospect lookup), FIX 3 (error logging) |
| `src/app/api/twilio-missed-call/route.ts` | FIX 2 (prospect lookup), FIX 3 (error logging) |
| `src/app/api/ivr/no-input/route.ts` | FIX 3 (error logging) |
| `src/app/api/ivr/after-record/route.ts` | FIX 3 (error logging), FIX 8 (transcript storage) |
| `src/app/api/ivr/voicemail-recording/route.ts` | FIX 3 (error logging), FIX 8 (transcript storage) |
| `src/app/api/twilio-sms-webhook/route.ts` | FIX 3 (error logging) |
| `src/lib/pipeline-auto-advance.ts` | FIX 5 (use updateManifestAndCascade) |
| `src/lib/stage-logic.ts` | FIX 6 (add manifest cascade) |
| `src/app/api/enrich/route.ts` | FIX 7 (use updateManifestAndCascade) |
| `src/lib/ghost-protocol-pipeline.ts` | FIX 9 (use updateManifestAndCascade) |
| `src/app/api/manifests/[id]/route.ts` | FIX 10 (use updateManifestAndCascade) |

---

*24,482 prospects. 23,910 phone numbers. 10 code fixes. 0 restructuring. This is plumbing — connect the data that exists to the code that needs it.*
