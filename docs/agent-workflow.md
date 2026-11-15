# Agent workflow

One open job belongs to one agent. The workstream is the head branch with its trailing four-character agent id removed (`cursor/calling-pool-v1-8d0d` is workstream `cursor/calling-pool-v1`). Fixes and rebases stay on that same branch and the same agent. A second agent on the same workstream shows up as overlap.

Reserve a migration version before launching work that adds a file under `supabase/migrations/`. Run `scripts/reserve-migration-version --pr <number|null> --owner <github-login> --note "<what it changes>"`. The helper takes the next free 14-digit version after the newest version on `main`, in `supabase/migrations/RESERVED.json`, and on open pull requests, then appends the reservation. Unknown pull requests use `"pr": null`.

Keep a pull request under 400 changed lines. The size gate ignores tests, fixtures, lockfiles, generated files, and docs. Above 400 it posts a split warning. Above 800 it fails unless the pull request has the `large-pr-approved` label.

Write the acceptance checks in the pull request body before review. Each check is an exact command or query and the result it should return.

Each head has one reviewer gate. Name that person in **Reviewer gate** and expect one review round.

`pr-overlap-guard` warns, with one sticky comment and the `possible-duplicate` label, when another open pull request shares the workstream, at least half of this pull request's changed non-test files, or a `supabase/migrations` file name. It leaves the check green. Dependabot pull requests are skipped. Draft and ready pull requests are both included.

`migration-version-guard` fails when two migration files share a 14-digit version, when a migration added here is missing from `RESERVED.json` for this pull request number, or when that version is also added by another open pull request. Duplicate 14-digit versions that already exist on the base are reported and left green. Versions shorter than 14 digits are outside this guard.

`pr-size-gate` posts the size warning and a separate warning when **Acceptance checks** is empty.
