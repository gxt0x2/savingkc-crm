# Mobile image parser hardening — August 26, 2026

## Decision

Replace Metro's vulnerable transitive `image-size@1.2.1` dependency with the
reviewed `image-size@2.0.3` hardening commit
`a42c2e5be4fc729f622f9a6879a643a1f3ff8ca1` from
`keyboard-dev/image-size`. The dependency is fetched from an immutable GitHub
codeload URL and locked with npm integrity metadata.

This is a build-time dependency repair. It does not change CRM behavior,
mobile application data, provider routing, or production records.

## Why this path

- GitHub advisories `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` affect
  every official `image-size` release through `2.0.2`.
- The upstream repository is archived and no official patched release exists.
- Expo 56 resolves Metro 0.84.4, which depends on `image-size`; forcing npm's
  suggested remediation would downgrade Expo and React Native.
- The pinned fork changes only the ICNS, HEIF, and JXL parser loops so malformed
  zero-length entries always advance or terminate. The package version is
  `2.0.3`, beyond the advisory range.

## Enforced verification

`npm run healthcheck` now fails unless all of the following are true:

1. `npm audit` reports no unapproved high or critical advisory.
2. The installed parser reports version `2.0.3`.
3. Crafted ICNS, HEIF, and JXL zero-length payloads terminate within one second.
4. The patched parser reads the checked-in Expo icon and splash assets.
5. Expo Doctor passes all 21 checks.
6. Mobile TypeScript passes.

The two temporary security exceptions are removed rather than extended.

## Rollback

Revert this change as one commit to restore the prior Expo lockfile and the two
time-bounded exceptions. Do not replace the immutable tarball with a branch or
floating tag. When an official patched `image-size` release is available,
replace the override with that release and rerun the malicious-input probes,
Expo Doctor, TypeScript, and the mobile dependency gate before merging.
