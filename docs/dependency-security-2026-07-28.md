# Dependency Security Hardening — 2026-07-28

## Scope

This change isolates dependency remediation from the CRM operating-model rebuild.

## Runtime remediation

- Next.js: `16.2.6` -> `16.2.12`
- Sharp: `0.34.5` -> `0.35.3`
- Next's nested PostCSS is overridden to `8.5.24`
- Next's nested Sharp is deduplicated to `0.35.3`

The overrides are required because Next.js 16.2.12 declares older nested versions even when the application has patched direct versions.

## Audit result

`npm audit --omit=dev`

- Critical: 0
- High: 0
- Moderate: 0
- Low: 0

The full development tree still reports nine high-severity findings in ESLint 9 and its plugins through `minimatch` and `brace-expansion`.

## Temporary development-tool exception

The registry-proposed remediation upgrades to ESLint 10.8.0. The versions of `eslint-plugin-import`, `eslint-plugin-react`, `eslint-plugin-jsx-a11y`, and `eslint-plugin-react-hooks` selected by `eslint-config-next@16.2.12` declare support through ESLint 9, not ESLint 10.

Do not force ESLint 10 or incompatible `minimatch` major versions into this release. Revisit when the Next.js lint plugin set supports ESLint 10 or patched ESLint 9-compatible dependency ranges are published.

This exception:

- Applies only to development and CI tooling.
- Does not permit high or critical production dependency findings.
- Must be reviewed before each rebuild release.
- Expires on 2026-08-28 unless renewed with new evidence.

## Verification

- 64 Vitest files passed.
- 397 tests passed.
- Next.js production build passed.
- Proxy registration passed after the build.
- Route integrity passed after the build.
- Production dependency audit returned zero findings.

## Known baseline gates

- Full-repository lint currently fails on pre-existing legacy errors across application code and scripts. The dependency upgrade did not attempt to rewrite those unrelated files.
- `gate:twilio` and `gate:edge` require `TWILIO_HEALTH_BEARER`; they must run in the protected CI or deployment environment before release.
