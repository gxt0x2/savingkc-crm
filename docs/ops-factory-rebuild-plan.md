# SavingKC CRM Factory Rebuild Plan

Date: 2026-06-04

## Current Diagnosis

The CRM already has many useful parts: lead detail, conversations, dialer, calendar, ARI, worker health APIs, Twilio webhooks, recordings, appointment reminders, and Mojo sync. The failure is system design. Operators do not have one place to see whether the factory is healthy, what broke, what needs human handling, and which automations are trusted.

There is also local project sprawl. Treat `/Users/ernestdodson/savingkc-crm` as the production CRM checkout unless a task explicitly says otherwise. The `Documents/New project` folder contains many older clones/worktrees that should be inventoried before deletion, not used as source of truth.

## Operating Model

Humans should handle direct calls, onsite visits, seller negotiation, and final judgment. The CRM should quietly run the plant: intake, identity resolution, phone hygiene, communications history, recording capture, task creation, appointment follow-up, automation health, website/form monitoring, and exception queues.

## Control Room

The new `/ops` route is the first control-room surface. It should become the daily starting point for:

- Communications: inbox, unmatched calls/texts, failed sends, replies, and call recordings.
- Lead Workbench: compact triage, stage ownership, next action, task state, and data gaps.
- Call Floor: dialer status, call queues, recording status, dispositions, and bad-number outcomes.
- Automation Health: worker status, stale runs, failed jobs, webhook failures, and alerts.
- Website / Domain Health: public website, PPC funnels, form submits, CRM attachment, DNS, SSL, and tracking.

## Lead Page Rebuild

The lead list should stop competing with the pipeline. Its job is inventory and triage:

- Default view: priority, seller, phone hygiene, source, stage, next action, last touch, owner, and data gaps.
- Bulk controls: assign, stage, priority, dial, SMS, delete, export, and verify numbers.
- Saved views: New inbound, Hot, Needs call, Unmatched comms, Bad/missing phone, Due today, Stale stage, Deceased/tax cohort.
- No oversized property media on list pages. Property media belongs in compact lead detail context.

The lead detail page should be split into stable panels:

- Header: seller identity, status, temperature, next action, quick call/SMS/email/task.
- Seller panel: contact info, phone hygiene, source, motivation, owner/co-owner state.
- Property panel: compact image, address, county, taxes, assessed value, condition, links.
- Communication panel: threaded SMS/email/calls, recordings, transcript/summary, failed sends.
- Task panel: open tasks, due dates, appointment follow-up, owner, automation-created items.
- Deal panel: ARV, repairs, debt, offer, contract, disposition/closing handoff.

## Communication Hub

The existing `/conversations` page is the base, but it needs operational queues:

- Unmatched phone numbers.
- Inbound missed calls without lead/activity linkage.
- Recordings over two minutes needing playback/review.
- Failed outbound SMS/email.
- Seller replies that pause or alter automation.
- Bad number / wrong number / DNC outcomes needing CRM state changes.

## Number Verifier

Current code normalizes phone numbers and logs failed SMS, but it does not enforce a pre-use clean-number gate. Add a `phone_verifications` table and service that can be used by imports, lead edit, dialer, SMS, bulk actions, and automations.

Minimum policy:

- Normalize to E.164.
- Block impossible numbers before save/send.
- Verify carrier/line type through Twilio Lookup or equivalent.
- Store status: clean, invalid, landline, voip-risk, dnc, wrong-number, disconnected, unknown.
- Require recent clean status before bulk SMS or dialer campaigns.
- Update status automatically from Twilio errors and call dispositions.

## Silent Failure Monitoring

Every automation must report one of four states: healthy, degraded, down, or blocked. A no-op is healthy only when the query ran, auth worked, and there was truly nothing to process.

Add or expose checks for:

- Twilio inbound SMS webhook.
- Twilio voice/status callbacks.
- Twilio recording callback and playable recording proxy.
- Appointment reminder worker.
- SMS sender worker and delivery log.
- Mojo sync and recording import.
- Website form submit to CRM attachment.
- Public website/PPC pages, SSL, DNS, and GTM/script presence.
- Google Ads conversion export, when in the Google Ads checkout.

## Local Cleanup Policy

Do not delete partial projects blindly. First build an inventory:

- Path, git remote, branch, latest commit, dirty files, untracked files, and package name.
- Whether it is a worktree, clone, build output, logs-only folder, or active production checkout.
- Whether any PR, deployment, or open work references it.

Only after that inventory should old worktrees move to quarantine or deletion.
