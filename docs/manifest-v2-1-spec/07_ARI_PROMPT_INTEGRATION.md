# 07 — Ari Prompt Integration

How to wire Ari to consume Markdown briefings from `renderManifestForAri` instead of raw manifest JSON.

---

## The change in one diagram

```
BEFORE:
  ariPromptBuilder(lead_id) {
    manifest = supabase.from('manifests').select('*').eq(...)
    prompt = SYSTEM_PROMPT + "\n\nLead data:\n" + JSON.stringify(manifest)
    return prompt
  }

AFTER:
  ariPromptBuilder(lead_id, intent='pre_call_briefing') {
    briefing = await renderManifestForAri(manifest_id_for(lead_id), intent)
    prompt = SYSTEM_PROMPT + "\n\n" + briefing
    return prompt
  }
```

---

## Where to find the integration points

Every place Ari's prompt is assembled. Grep candidates:

```bash
# Functions that build prompts for Ari
rg -n "(systemPrompt|system_prompt|buildPrompt|assemblePrompt|ariPrompt)" --type=ts --type=tsx

# Places that call the Anthropic API
rg -n "anthropic\.(messages|completions)\.create" --type=ts --type=tsx
rg -n "claude-(opus|sonnet|haiku)" --type=ts --type=tsx

# Places that stringify manifests
rg -n "JSON\.stringify.*manifest" --type=ts --type=tsx
```

Most likely locations based on Next.js 16 conventions:
- `src/lib/ari/prompt.ts`
- `src/lib/ari/briefing.ts`
- `src/app/api/ari/route.ts`
- `src/lib/agents/*.ts`

---

## The pattern to apply everywhere

Replace:

```typescript
// OLD
const { data: manifest } = await supabase
  .from('manifests')
  .select('*')
  .eq('lead_id', leadId)
  .single();

const prompt = `${ARI_SYSTEM_PROMPT_V3}

Current lead data:
${JSON.stringify(manifest, null, 2)}
`;
```

With:

```typescript
// NEW
const { data: row } = await supabase
  .from('manifests')
  .select('id')
  .eq('lead_id', leadId)
  .single();

if (!row) throw new Error(`No manifest for lead ${leadId}`);

const briefing = await renderManifestForAri(row.id, 'pre_call_briefing');

const prompt = `${ARI_SYSTEM_PROMPT_V3}

${briefing}
`;
```

**Notes:**

- The briefing is already Markdown with section headers. Do not wrap it in backticks. Do not prefix it with "Here's the lead data:" — that is redundant framing that wastes tokens.
- Do not `JSON.parse` or manipulate the briefing. It is a rendered final output.
- If Ari needs structured fields for tool-call arguments, build a separate lightweight function `getManifestFields(manifestId, fields: string[])` that returns just the raw values. Do not use the rendered briefing for that.

---

## System prompt update

The Ari Briefing System Prompt V3 was written assuming JSON input. It needs a small update.

### Change these rules

**Old (approximate):**

> You will receive lead data as a JSON manifest. Parse the `motivationScore`, `personality.type`, and `situation` fields to inform your briefing.

**New:**

> You will receive a pre-rendered Markdown briefing. It already highlights the critical decision-drivers (motivation score, personality, objections, leverage). Do not re-summarize — act on it. If a section is marked "Evaluation in progress" or is absent, do not fabricate; acknowledge the gap and advise what to collect next.

### Add these rules

1. The briefing is authoritative. If it omits a section, that information is not available — do not hallucinate it.
2. If the briefing header shows "⚠️ Briefing flagged stale," treat the data as provisional and call out the staleness in your output.
3. When recommending next actions, prefer actions that close data gaps listed under "Context flags → Missing."
4. Do not quote the briefing back to the user. Synthesize.

---

## Tool-call handoffs

Ari will still need structured data for certain tool calls (writing back a disposition, scoring a lead, etc.). Do not route those through the briefing serializer. Keep two paths:

| Path | Used for | Returns |
|---|---|---|
| `renderManifestForAri(id, intent)` | Ari's reading context | Markdown |
| `getManifestFields(id, fields)` | Tool-call argument extraction | Typed struct |
| `updateManifestAndCascade(...)` | Ari's writes | Confirmation |

This separation means Ari's LLM context stays clean Markdown, while the application code around it operates on typed data. Neither crosses into the other.

---

## Validation

After wiring:

1. Open dev. Trigger an Ari pre-call briefing for a known lead.
2. Confirm the briefing Ari produces references specific details from the Markdown (motivation score, personality type, open objections).
3. Confirm Ari does not output JSON or refer to "the manifest" as a technical object.
4. Confirm token usage in the Anthropic API call log dropped meaningfully vs. the JSON-based version. Expected: 30-60% reduction.

If token usage did not drop, something is still stringifying the manifest somewhere. Grep again.
