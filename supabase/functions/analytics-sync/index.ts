/* eslint-disable @typescript-eslint/no-explicit-any -- Deno edge function carried over verbatim from live v4; Google API payloads are untyped. */
// analytics-sync: GSC + GA4 pull; Admin key-event mark when SA has analytics.edit + Editor on property.
// v5 (2026-11-06): + GA4 eventName × landingPage × sessionSourceMedium daily (ga4_event_daily) and a
// read-only events_probe mode. Source of truth now lives in the CRM repo (supabase/functions/analytics-sync).
// Secrets: SKC_ANALYTICS_SA_JSON, GA4_PROPERTY_ID; caller token Vault analytics_sync_token.
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GSC_SITE = "sc-domain:savingkc.com";
const KEY_EVENTS = ["generate_lead", "phone_click", "form_started", "appointment_booked"] as const;
const b64u = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
type ScopeMode = "readonly" | "edit";
async function token(mode: ScopeMode = "readonly"): Promise<string> {
  const sa = JSON.parse(Deno.env.get("SKC_ANALYTICS_SA_JSON")!);
  const now = Math.floor(Date.now() / 1000);
  const scopes = mode === "edit"
    ? "https://www.googleapis.com/auth/analytics.edit https://www.googleapis.com/auth/webmasters.readonly"
    : "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
  const claim = { iss: sa.client_email, scope: scopes, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const unsigned = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64u(JSON.stringify(claim));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64u(sig) }) });
  const j = await r.json(); if (!j.access_token) throw new Error("token: " + (j.error_description || j.error)); return j.access_token;
}
function saEmail(): string {
  return JSON.parse(Deno.env.get("SKC_ANALYTICS_SA_JSON")!).client_email;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));
async function upsert(table: string, rows: any[], conflict: string) {
  for (let i = 0; i < rows.length; i += 1000) { const { error } = await sb.from(table).upsert(rows.slice(i, i + 1000), { onConflict: conflict }); if (error) throw new Error(table + ": " + error.message); }
}
async function gsc(tok: string, since: string, until: string) {
  let n = 0;
  for (let d = new Date(since); iso(d) <= until; d = new Date(d.getTime() + 864e5)) {
    const day = iso(d);
    for (let start = 0; ; start += 25000) {
      const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ startDate: day, endDate: day, dimensions: ["page", "query", "country", "device"], rowLimit: 25000, startRow: start, dataState: "all" }) });
      const j = await r.json(); if (!r.ok) throw new Error("gsc: " + JSON.stringify(j.error?.message ?? j));
      const rows = (j.rows ?? []).map((x: any) => ({ date: day, page: x.keys[0], query: x.keys[1], country: x.keys[2], device: x.keys[3], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position, synced_at: new Date().toISOString() }));
      await upsert("gsc_page_query_daily", rows, "date,page,query,country,device"); n += rows.length;
      if (rows.length < 25000) break;
    }
  }
  return n;
}
async function ga4(tok: string, since: string, until: string) {
  const pid = Deno.env.get("GA4_PROPERTY_ID"); if (!pid) throw new Error("GA4_PROPERTY_ID not set");
  let n = 0;
  for (let offset = 0; ; offset += 100000) {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate: since, endDate: until }], dimensions: [{ name: "date" }, { name: "landingPage" }, { name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }, { name: "newUsers" }], limit: 100000, offset }) });
    const j = await r.json(); if (!r.ok) throw new Error("ga4: " + JSON.stringify(j.error?.message ?? j));
    const rows = (j.rows ?? []).map((x: any) => { const d = x.dimensionValues[0].value; return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, landing_page: x.dimensionValues[1].value, session_source_medium: x.dimensionValues[2].value, sessions: +x.metricValues[0].value, engaged_sessions: +x.metricValues[1].value, key_events: +x.metricValues[2].value, new_users: +x.metricValues[3].value, synced_at: new Date().toISOString() }; });
    await upsert("ga4_landing_daily", rows, "date,landing_page,session_source_medium"); n += rows.length;
    if (rows.length < 100000) break;
  }
  return n;
}
// Allowlist keeps rows small: every event × landing × source would explode with scroll/user_engagement.
const GA4_EVENT_ALLOW = [
  "page_view", "session_start", "first_visit",
  "generate_lead", "lead_submitted", "form_started", "form_step_completed",
  "phone_click", "appointment_booked", "cta_click", "quiz_started", "quiz_qualified", "contact_started",
];
async function ga4Events(tok: string, since: string, until: string) {
  const pid = Deno.env.get("GA4_PROPERTY_ID"); if (!pid) throw new Error("GA4_PROPERTY_ID not set");
  let n = 0;
  for (let offset = 0; ; offset += 100000) {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: since, endDate: until }],
        dimensions: [{ name: "date" }, { name: "eventName" }, { name: "landingPage" }, { name: "sessionSourceMedium" }],
        metrics: [{ name: "eventCount" }, { name: "keyEvents" }],
        dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: GA4_EVENT_ALLOW } } },
        keepEmptyRows: false,
        limit: 100000, offset,
      }),
    });
    const j = await r.json(); if (!r.ok) throw new Error("ga4_events: " + JSON.stringify(j.error?.message ?? j));
    const rows = (j.rows ?? []).map((x: any) => {
      const d = x.dimensionValues[0].value;
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`,
        event_name: x.dimensionValues[1].value,
        landing_page: x.dimensionValues[2].value || "(not set)",
        session_source_medium: x.dimensionValues[3].value || "(not set)",
        event_count: +x.metricValues[0].value,
        key_events: +x.metricValues[1].value,
        synced_at: new Date().toISOString(),
      };
    });
    await upsert("ga4_event_daily", rows, "date,event_name,landing_page,session_source_medium"); n += rows.length;
    if (rows.length < 100000) break;
  }
  return n;
}
// Read-only: eventName × isKeyEvent for the last N days. Writes nothing (not even a run row).
async function ga4EventsProbe(tok: string, days = 30) {
  const pid = Deno.env.get("GA4_PROPERTY_ID"); if (!pid) throw new Error("GA4_PROPERTY_ID not set");
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${Math.max(1, Math.min(365, days))}daysAgo`, endDate: "yesterday" }],
      dimensions: [{ name: "eventName" }, { name: "isKeyEvent" }],
      metrics: [{ name: "eventCount" }, { name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 200,
    }),
  });
  const j = await r.json(); if (!r.ok) throw new Error("ga4_probe: " + JSON.stringify(j.error?.message ?? j));
  return (j.rows ?? []).map((x: any) => ({ event: x.dimensionValues[0].value, is_key_event: x.dimensionValues[1].value, count: +x.metricValues[0].value, key_events: +x.metricValues[1].value }));
}
async function run(source: "gsc" | "ga4" | "ga4_events", mode: string, since: string, until: string, tok: string) {
  const { data } = await sb.from("analytics_sync_runs").insert({ source, mode, since_date: since, until_date: until }).select("id").single();
  try { const n = source === "gsc" ? await gsc(tok, since, until) : source === "ga4" ? await ga4(tok, since, until) : await ga4Events(tok, since, until);
    await sb.from("analytics_sync_runs").update({ status: "ok", rows_upserted: n, finished_at: new Date().toISOString() }).eq("id", data!.id); return { source, ok: true, rows: n };
  } catch (e) { await sb.from("analytics_sync_runs").update({ status: "failed", error: String(e).slice(0, 1000), finished_at: new Date().toISOString() }).eq("id", data!.id); return { source, ok: false, error: String(e) }; }
}
async function listKeyEvents(tok: string, pid: string) {
  const r = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${pid}/keyEvents`, { headers: { authorization: `Bearer ${tok}` } });
  const j = await r.json();
  if (!r.ok) return { ok: false as const, status: r.status, error: j };
  return { ok: true as const, events: (j.keyEvents ?? []).map((e: any) => e.eventName) };
}
async function createKeyEvent(tok: string, pid: string, eventName: string) {
  const r = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${pid}/keyEvents`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ eventName, countingMethod: "ONCE_PER_EVENT" }),
  });
  const j = await r.json();
  return { eventName, status: r.status, ok: r.ok, body: j };
}
Deno.serve(async (req) => {
  const { data: ok } = await sb.rpc("analytics_sync_token_ok", { t: req.headers.get("x-sync-token") ?? "" });
  if (ok !== true) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (b.mode === "whoami") {
    const email = saEmail();
    return Response.json({ client_email: email, property_id: Deno.env.get("GA4_PROPERTY_ID") ?? null, needs: "GA4 Property Access → add this SA as Editor (not Viewer). Then mode mark_key_events." });
  }
  if (b.mode === "mark_key_events") {
    const pid = Deno.env.get("GA4_PROPERTY_ID"); if (!pid) return Response.json({ ok: false, error: "GA4_PROPERTY_ID missing" }, { status: 500 });
    let tok: string;
    try { tok = await token("edit"); } catch (e) { return Response.json({ ok: false, step: "token_edit", error: String(e), client_email: saEmail() }, { status: 500 }); }
    const listed = await listKeyEvents(tok, pid);
    if (!listed.ok) {
      return Response.json({ ok: false, step: "list_key_events", client_email: saEmail(), status: listed.status, error: listed.error, hint: "Grant this SA Editor on property 343413035 and enable Analytics Admin API on the GCP project." }, { status: 403 });
    }
    const existing = new Set(listed.events);
    const results = [];
    for (const name of KEY_EVENTS) {
      if (existing.has(name)) { results.push({ eventName: name, skipped: true, reason: "already_key_event" }); continue; }
      results.push(await createKeyEvent(tok, pid, name));
    }
    const listed2 = await listKeyEvents(tok, pid);
    return Response.json({ ok: true, client_email: saEmail(), before: listed.events, results, after: listed2.ok ? listed2.events : listed2 });
  }
  const mode = b.mode === "backfill" ? "backfill" : "nightly";
  const until = b.until ?? daysAgo(1);
  const src = b.source ?? "both";
  const tok = await token("readonly");
  if (b.mode === "events_probe") {
    try { return Response.json({ ok: true, days: Number(b.days) || 30, events: await ga4EventsProbe(tok, Number(b.days) || 30) }); }
    catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
  }
  if (b.mode === "discover") {
    const j = await (await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", { headers: { authorization: `Bearer ${tok}` } })).json();
    const out: any[] = [];
    for (const a of j.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) {
      const s = await (await fetch(`https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`, { headers: { authorization: `Bearer ${tok}` } })).json();
      out.push({ account: a.displayName, property: p.property, name: p.displayName, streams: (s.dataStreams ?? []).map((d: any) => d.webStreamData?.measurementId) });
    }
    await sb.from("analytics_sync_runs").insert({ source: "ga4", mode: "discover", status: "ok", finished_at: new Date().toISOString(), error: JSON.stringify(out).slice(0, 1000) });
    return Response.json(out);
  }
  const out = [];
  if (src === "both" || src === "gsc") out.push(await run("gsc", mode, mode === "backfill" ? (b.since ?? daysAgo(486)) : daysAgo(3), until, tok));
  if (src === "both" || src === "ga4") out.push(await run("ga4", mode, mode === "backfill" ? (b.since ?? "2015-08-14") : daysAgo(3), until, tok));
  // Event grain is heavier than landing grain: backfill defaults to 90 days. Nightly ({"mode":"nightly"}) picks it up.
  if (src === "both" || src === "ga4_events") out.push(await run("ga4_events", mode, mode === "backfill" ? (b.since ?? daysAgo(90)) : daysAgo(3), until, tok));
  return Response.json(out);
});
