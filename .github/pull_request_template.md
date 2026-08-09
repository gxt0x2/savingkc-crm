## What changed

-

## Why

-

## Risk

-

## Validation

-

## Ownership and hygiene

- [ ] New routes, tables, environment variables, crons, and polling are registered in `src/config/system-registry.json`.
- [ ] Data growth and retention impact were reviewed; destructive migrations have a bounded, reversible safety justification.
- [ ] `npm run hygiene` passes against the PR base.
- [ ] User-facing changes were verified through the complete affected workflow, not only an isolated component.

## Rollback

-

## Notes

- Do not include secret values, tokens, env dumps, customer PII, or GitHub secret-scanning alert payloads.
