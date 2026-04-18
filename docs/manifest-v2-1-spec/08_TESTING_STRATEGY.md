# 08 — Testing Strategy

Tests required before each phase merges. No shortcuts.

---

## Test stack assumptions

- Unit tests: Vitest or Jest (use whatever is already in `package.json`).
- Integration tests: against a dedicated test Supabase project or local Supabase dev.
- Snapshot tests: Vitest/Jest snapshots, committed as `.snap` files.
- Token counting: `gpt-tokenizer` or `@anthropic-ai/tokenizer`.

---

## Schema tests (`schema.test.ts`)

**Purpose:** prove the schema accepts every valid shape and rejects every invalid shape.

```typescript
import { describe, it, expect } from 'vitest';
import { manifestV2_1Schema } from './schema';
import { fullFixture, minimalFixture } from './__fixtures__';

describe('manifestV2_1Schema', () => {
  describe('valid inputs', () => {
    it('accepts a fully populated manifest', () => {
      expect(() => manifestV2_1Schema.parse(fullFixture)).not.toThrow();
    });

    it('accepts a minimal manifest with only required fields', () => {
      expect(() => manifestV2_1Schema.parse(minimalFixture)).not.toThrow();
    });

    it('accepts "pending" sentinel where allowed', () => {
      const m = { ...minimalFixture, next_action: 'pending' };
      expect(() => manifestV2_1Schema.parse(m)).not.toThrow();
    });
  });

  describe('rejects empty collections', () => {
    it('rejects empty arrays in optional non-empty fields', () => {
      const m = { ...fullFixture, situation: { ...fullFixture.situation, objections: [] } };
      expect(() => manifestV2_1Schema.parse(m)).toThrow();
    });

    it('rejects empty objects', () => {
      const m = { ...fullFixture, personality: {} };
      expect(() => manifestV2_1Schema.parse(m)).toThrow();
    });
  });

  describe('strict mode', () => {
    it('rejects unknown top-level fields', () => {
      const m = { ...fullFixture, foo: 'bar' };
      expect(() => manifestV2_1Schema.parse(m)).toThrow();
    });
  });

  describe('branded IDs', () => {
    it('accepts UUIDs', () => {
      const m = { ...fullFixture, manifest_id: '550e8400-e29b-41d4-a716-446655440000' };
      expect(() => manifestV2_1Schema.parse(m)).not.toThrow();
    });

    it('rejects non-UUID strings', () => {
      const m = { ...fullFixture, manifest_id: 'not-a-uuid' };
      expect(() => manifestV2_1Schema.parse(m)).toThrow();
    });
  });
});
```

---

## Write path tests (`write.test.ts`)

**Purpose:** prove `updateManifestAndCascade` holds the discipline the doctrine demands.

```typescript
describe('updateManifestAndCascade', () => {
  it('replaces subtrees shallowly, preserving unspecified subtrees', async () => {
    await seedManifest(existingFixture);
    await updateManifestAndCascade({
      manifest_id: existingFixture.manifest_id,
      subtrees: { motivation: newMotivation },
      actor: 'ari',
      reason: 'post-call update',
    });

    const after = await readManifest(existingFixture.manifest_id);
    expect(after.motivation).toEqual(newMotivation);
    expect(after.property).toEqual(existingFixture.property);  // untouched
    expect(after.seller).toEqual(existingFixture.seller);      // untouched
  });

  it('does not create nested manifest.manifest paths', async () => {
    await updateManifestAndCascade({ /* ... */ });
    const raw = await rawSelect(existingFixture.manifest_id);
    expect(raw.data).not.toHaveProperty('manifest');
  });

  it('rejects invalid payloads via Zod', async () => {
    await expect(
      updateManifestAndCascade({
        manifest_id: existingFixture.manifest_id,
        subtrees: { situation: { objections: [] } },   // empty array banned
        actor: 'ari',
        reason: 'test',
      }),
    ).rejects.toThrow(/objections/);
  });

  it('strips caller-set derived fields and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn');
    await updateManifestAndCascade({
      manifest_id: existingFixture.manifest_id,
      subtrees: {
        hot_eligibility: { verdict: 'eligible', /* ... */ },
      },
      actor: 'casey',
      reason: 'test',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hot_eligibility'));
  });

  it('writes a manifest_history row on success', async () => {
    const before = await countHistory(existingFixture.manifest_id);
    await updateManifestAndCascade({ /* valid */ });
    const after = await countHistory(existingFixture.manifest_id);
    expect(after).toBe(before + 1);
  });

  it('rolls back on history write failure', async () => {
    mockHistoryInsert.mockRejectedValueOnce(new Error('simulated'));
    const snapshot = await readManifest(existingFixture.manifest_id);
    await expect(updateManifestAndCascade({ /* valid */ })).rejects.toThrow();
    const after = await readManifest(existingFixture.manifest_id);
    expect(after).toEqual(snapshot);
  });
});
```

---

## Trigger test (database-level guard)

**Purpose:** prove direct writes fail even if the app code has bugs.

```typescript
describe('database write-path guard', () => {
  it('rejects direct updates to manifests', async () => {
    await expect(
      rawAdminClient.from('manifests').update({ data: {} }).eq('id', someId),
    ).rejects.toThrow(/Direct writes to manifests are forbidden/);
  });

  it('allows writes when app.write_path is set to cascade', async () => {
    await rawAdminClient.rpc('set_config', { key: 'app.write_path', value: 'cascade' });
    await expect(
      rawAdminClient.from('manifests').update({ data: validJson }).eq('id', someId),
    ).resolves.not.toThrow();
  });
});
```

---

## Serializer tests (`render.test.ts`)

**Purpose:** prove the Markdown output is correct, deterministic, and within budget.

### Fixtures

Five committed JSON files under `src/lib/manifest/__fixtures__/`:

1. `full.json` — every field populated, realistic KC-area wholesaling lead.
2. `minimal.json` — only required fields.
3. `pending.json` — several fields in `"pending"` state.
4. `hot.json` — qualifies for Hot Opportunity.
5. `stale.json` — `briefing_stale: true`.

### Snapshot tests

```typescript
import { renderManifestForAri } from './render';

const FROZEN_NOW = new Date('2026-04-18T14:00:00Z');

describe('pre_call_briefing snapshots', () => {
  it.each(['full', 'minimal', 'pending', 'hot', 'stale'])(
    'renders %s fixture',
    async (name) => {
      const fixture = loadFixture(name);
      await seedManifest(fixture);
      const out = await renderManifestForAri(
        fixture.manifest_id,
        'pre_call_briefing',
        { now: FROZEN_NOW },
      );
      expect(out).toMatchSnapshot();
    },
  );
});
```

Review the generated snapshots visually. Commit them. Future changes that modify output will surface as snapshot diffs in PRs — that is the feature.

### Token budget test

```typescript
import { encode } from 'gpt-tokenizer';

describe('pre_call_briefing token budget', () => {
  it.each(['full', 'minimal', 'pending', 'hot', 'stale'])(
    '%s fixture fits under 1500 tokens',
    async (name) => {
      const fixture = loadFixture(name);
      await seedManifest(fixture);
      const out = await renderManifestForAri(
        fixture.manifest_id,
        'pre_call_briefing',
        { now: FROZEN_NOW },
      );
      expect(encode(out).length).toBeLessThan(1500);
    },
  );
});
```

### Determinism test

```typescript
it('is deterministic for identical inputs and frozen now', async () => {
  const a = await renderManifestForAri(id, 'pre_call_briefing', { now: FROZEN_NOW });
  const b = await renderManifestForAri(id, 'pre_call_briefing', { now: FROZEN_NOW });
  expect(a).toBe(b);
});
```

### Trimming test

```typescript
it('trims low-value sections when under tight budget', async () => {
  const out = await renderManifestForAri(fullId, 'pre_call_briefing', {
    now: FROZEN_NOW,
    token_budget: 500,
  });
  expect(out).not.toContain('## Red flags');      // first to go
  expect(out).toContain('## What to do');          // never trimmed
  expect(out).toContain('## Financials at a glance');  // never trimmed
});
```

### Null/missing/pending rendering

```typescript
describe('three-state rendering', () => {
  it('omits sections where subtree is missing', async () => {
    const m = { ...minimalFixture };
    delete m.situation;
    await seedManifest(m);
    const out = await renderManifestForAri(m.manifest_id, 'pre_call_briefing');
    expect(out).not.toContain('## Open objections');
  });

  it('renders pending as "Evaluation in progress"', async () => {
    const m = { ...minimalFixture, next_action: 'pending' };
    await seedManifest(m);
    const out = await renderManifestForAri(m.manifest_id, 'pre_call_briefing');
    expect(out).toContain('Evaluation in progress');
  });

  it('renders null subtree fields without "Not available" filler', async () => {
    const m = structuredClone(fullFixture);
    m.situation.red_flags = null;
    await seedManifest(m);
    const out = await renderManifestForAri(m.manifest_id, 'pre_call_briefing');
    expect(out).not.toContain('## Red flags');
    expect(out).not.toContain('Not available');
  });
});
```

---

## Migration tests (`migration.test.ts`)

**Purpose:** prove the transform function produces valid V2.1 from every plausible V2.0 shape.

```typescript
describe('transformToV2_1', () => {
  it('collapses self-nested manifest', () => {
    const nested = {
      id: '...', leadId: '...',
      manifest: {
        manifest: { owner: { name: 'Jane' } },
        owner: { name: 'Jane' },
      },
      owner: { name: 'Jane' },
    };
    const out = transformToV2_1(nested);
    expect(out).not.toHaveProperty('manifest');
    expect(out.seller.full_name).toBe('Jane');
  });

  it('extracts embedded transcript from manifest and leaves only the call_id', () => {
    const withTranscript = { /* fixture with embedded transcript */ };
    const out = transformToV2_1(withTranscript);
    expect(JSON.stringify(out).length).toBeLessThan(10000);
    expect(out.sources.latest_call_id).toBeTruthy();
  });

  it('maps empty arrays to null', () => {
    const messy = { /* fixture with redFlags: [] */ };
    const out = transformToV2_1(messy);
    expect(out.situation?.red_flags).toBeNull();
  });

  it('is idempotent — running twice yields the same result', () => {
    const once = transformToV2_1(originalV2_0);
    const twice = transformToV2_1(once);
    expect(twice).toEqual(once);
  });

  it('produces output that passes Zod validation', () => {
    for (const fixture of v2_0Fixtures) {
      const out = transformToV2_1(fixture);
      expect(() => manifestV2_1Schema.parse(out)).not.toThrow();
    }
  });
});
```

---

## End-to-end test

**Purpose:** prove Ari gets a working briefing end-to-end.

```typescript
describe('e2e: Ari pre-call briefing pipeline', () => {
  it('loads manifest, renders briefing, injects into Ari prompt', async () => {
    await seedManifest(fullFixture);

    const prompt = await buildAriPrompt(fullFixture.lead_id, 'pre_call_briefing');

    expect(prompt).toContain(ARI_SYSTEM_PROMPT_V3);
    expect(prompt).toContain('# Pre-Call Briefing');
    expect(prompt).toContain(fullFixture.seller.full_name);
    expect(prompt).not.toContain(JSON.stringify(fullFixture));  // no raw JSON
  });
});
```

---

## CI gate

In `.github/workflows/*.yml` (or whatever CI is in use), add:

```yaml
- name: Validate all manifests against V2.1 schema
  run: npx tsx scripts/migration/04_verify.ts
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

Any manifest that fails validation blocks the build. This is the guarantee that no code change can produce a V2.1-invalid manifest in production.
