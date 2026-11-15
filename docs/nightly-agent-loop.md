# Nightly agent loop

`.github/workflows/nightly-agent-loop.yml` runs at 03:00 UTC (`0 3 * * *`), which is 9:00pm America/Chicago: 9pm CST / 10pm CDT. It can also be started with `workflow_dispatch` inputs `depth` (default 0) and `reason`.

The workflow stays off until both of these are set:

- repository variable `NIGHTLY_AGENT_ENABLED` is exactly `true`
- secret `CURSOR_API_KEY` is present

Otherwise the run logs `disabled` and exits 0. Merging the workflow does not launch an agent.

When main's required checks are green, the run logs `clear` and does not launch. Required check names come from the branch ruleset when that API is readable. If it is not, any failing check run or combined status counts as red. In-progress checks log `pending` and record outcome `clear` so no agent starts.

A red main launches one Cursor cloud agent (`POST https://api.cursor.com/v1/agents`) on this repo. The prompt tells it to open a pull request, not to merge or approve, and to leave review to Katherine's gate. `workOnCurrentBranch` is false.

The launch body always includes `model.id`. The pinned id is `grok-4.7` (`AGENT_MODEL`). Empty values and ids that do not start with `grok` log `model_not_allowed` and launch nothing. If the create, get-agent, or get-run payload reports a different model id, the run is cancelled and the outcome is `model_mismatch`. The public v1 agent and run schemas do not echo the model; when the field is absent the loop keeps the requested id and continues.

Create Agent has no native max-duration field. `AGENT_MAX_MINUTES` is 30. The action polls no faster than every 30 seconds and cancels with `POST /v1/agents/{id}/runs/{runId}/cancel` if the run is still active at 30 minutes (`timed_out`). The job `timeout-minutes` is 40.

Cursor calls share one wrapper: at least 6 seconds between calls (under 20 per minute), poll interval 30 seconds, and up to 5 retries on 429 and 5xx with exponential backoff, jitter, and `Retry-After`.

After the run, main is checked again. If it is still failing and `depth` is 0 or 1, the workflow dispatches itself with `depth + 1`. Depth 2 does not dispatch and logs `max_tries_reached`. The workflow never merges, approves, or enables auto-merge.

Each run appends a line to the step summary and uploads `nightly-agent-outcome.json` with depth, agent id, start, end, duration in seconds, and outcome.

`DRY_RUN=true node scripts/nightly-agent/run.mjs` prints the depth cap, the 30-minute timeout, and the model gates without calling Cursor or GitHub. `node --test scripts/nightly-agent/run.test.mjs` covers the same cases.
