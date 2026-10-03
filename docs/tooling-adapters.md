# Scoped matcher adapters

These private local packages replace two verified tooling interfaces, without changing CRM source, native dependencies, lint rules, the high-severity npm audit threshold, or mobile security exceptions. They are not upstream patched releases. npm local-file dependencies and consumer-scoped overrides resolve the original import names to honest `@savingkc/*` package names. The actual graph removes `braces` and upstream `micromatch`; normal registry audits remain enabled.

## Next ESLint roots

`tooling/next-root-glob` supports only `globSync(string, {onlyDirectories:true})`, the sole interface used by `@next/eslint-plugin-next` 16.3.8. It uses published brace-expansion 5.0.12, Picomatch 4.0.7, glob-parent 6.0.2 and the same @nodelib/fs.walk 1.2.8 breadth-first directory walker as the previous implementation. Static alternatives precede dynamic tasks; alternatives retain stable length ordering, directory symlinks are followed, and task roots are excluded from recursive results. Errors other than missing paths propagate.

A direct Node fs.globSync substitution changed recursive bases/order and failed recursive symlink traversal. A direct Tinyglobby substitution also changed symlink results. Neither substitution was shipped. The scoped adapter is covered by 130 baseline-derived contracts through the real Next helper, including literal/hidden roots, absolute and parent paths, arrays, brace sets/ranges, extglobs, recursive symlinks, broken symlinks and ordering. No vulnerable oracle is installed in the candidate graph.

Excessive configuration fails explicitly: input or total expanded text above 65536 characters, more than 1000 expanded alternatives, or brace nesting above 1000 levels raises RangeError. Unsupported options/APIs raise TypeError. These documented configuration limits prevent parser stack exhaustion and expansion work from silently truncating root selection. This is not a general fast-glob API. The lint adapter requires Node >=22.13.0 for supported synchronous CommonJS consumption of its ESM entry; release CI uses Node 22 and the backend uses Node 24. The ESM imports satisfy the existing repository lint rule without changing that rule.

`gate:security` first runs the new consumer/scope guard and contract tests, then retains the original secret-fallback check and `npm audit --audit-level=high`. The guard pins the observed Next consumer version/source and rejects added imports or a returned vulnerable chain. Do not broaden the override or relax the guard on dependency upgrades; review the new actual consumer first. All Next lint rules remain configured.

## Metro watchers

Both `apps/mobile/tooling/metro-matcher` and the standalone mobile repository carry the same private adapter. It exposes only `.some`, preserving Micromatch's per-pattern OR loop, string conversion, array coercion and matcher options while calling published Picomatch 4.0.7. Negated patterns remain separate predicates; they are not converted into a combined exclusion list. Picomatch was already the engine used inside Micromatch.some.

Overrides affect only the verified @expo/metro-file-map and metro-file-map consumers. Each app owns its files inside the EAS upload root. The guard pins locked consumer versions/source fingerprints, checks every installed consumer resolves to the honest local package, exercises its real includedByGlob predicate, and rejects a returned braces/upstream-Micromatch chain. It runs before the existing embedded healthcheck; all prior audit policy, patched image parser, Expo doctor and TypeScript checks remain intact. The standalone guard likewise precedes its existing pretests.

A dependency upgrade must reverify the consumer API and watcher behavior before changing the version/source fingerprints. No SDK, React Native, signing, EAS project, app identity, or security-exception change is part of this adapter change. The pre-existing embedded node-forge exception remains governed by its existing expiry and owner. Moderate CSV remediation is separate.

## Release validation

Review artifacts outside the repositories record clean npm installs, baseline/candidate dependency deltas and audits, actual-consumer differential fixtures, synthetic watcher create/modify/rename/delete/dotfile/symlink/restart runs, native/web exports and runtime module inventories, unchanged full coverage/build/typechecks, and source freezes. Independent Astra review and required CI must clear before publication or release continuation. Fixture exports are not signed device acceptance, provider delivery verification, or a production release.
