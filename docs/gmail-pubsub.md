# Gmail near-realtime ingest

Sync now stays a pull: `POST /api/cron/sync-gmail/trigger` lists recent messages with the saved Google OAuth token.

Push is optional. When the env below is set, Connect and the 5-minute Gmail cron call `users.watch`. Google publishes mailbox changes to Pub/Sub, Pub/Sub POSTs them to the CRM, and the CRM runs `users.history.list` through the same lead-email upsert as Sync now. Duplicate notifications hit `gmail_push_receipts` and `lead_emails (lead_id, gmail_message_id)` and do not insert a second row.

If topic, subscription, or push auth env is missing, watch is skipped and the webhook returns 503. Sync now still works.

Scopes stay `gmail.readonly`, `gmail.send`, and `calendar`. `users.watch`, `users.stop`, and `users.history.list` use `gmail.readonly`. This does not add `gmail.modify`.

Push runs only for `@savingkc.com` mailboxes, the OAuth sandbox mailbox `savingkc@gmail.com`, a Google mailbox linked to a `@savingkc.com` CRM user, or addresses in `GMAIL_WATCH_MAILBOX_ALLOWLIST`.

## GCP resources Ernest must create

In the Google Cloud project that owns the OAuth client (local notes use `savingkc-chat-bot`):

1. Enable the Gmail API and Cloud Pub/Sub API.
2. Create a topic, for example `projects/<gcp-project>/topics/savingkc-gmail-push`.
3. Grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher role on that topic. Gmail will not publish without this grant.
4. Create a push subscription on that topic, for example `projects/<gcp-project>/subscriptions/savingkc-gmail-push`.
5. Set the push endpoint to `https://crm.savingkc.com/api/webhooks/google/gmail`.
6. Authenticate the push with an OIDC token:
   - Service account: a dedicated account such as `gmail-push@<gcp-project>.iam.gserviceaccount.com`
   - Audience: `https://crm.savingkc.com/api/webhooks/google/gmail` (the exact push URL, no query string)
7. The subscription resource name in the push body must match `GOOGLE_PUBSUB_SUBSCRIPTION`.

Alternative to OIDC: set the push endpoint to `https://crm.savingkc.com/api/webhooks/google/gmail?token=<GOOGLE_PUBSUB_PUSH_SECRET>` and leave the OIDC audience and service account unset. The secret must be at least 16 characters. Do not commit it.

Create the subscription only after the env vars are on the deployment. Until then the webhook fails closed and Pub/Sub will retry.

## Env vars

Set these in Vercel Production (and Preview if that environment should watch):

```text
GOOGLE_PUBSUB_TOPIC=projects/<gcp-project>/topics/savingkc-gmail-push
GOOGLE_PUBSUB_SUBSCRIPTION=projects/<gcp-project>/subscriptions/savingkc-gmail-push
GOOGLE_PUBSUB_PUSH_AUDIENCE=https://crm.savingkc.com/api/webhooks/google/gmail
GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT=gmail-push@<gcp-project>.iam.gserviceaccount.com
GOOGLE_PUBSUB_PUSH_SECRET=
GMAIL_WATCH_MAILBOX_ALLOWLIST=
```

`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` stay the existing Gmail connect credentials. Reconnect is not required for a mailbox that already granted `gmail.readonly`.

`GMAIL_WATCH_MAILBOX_ALLOWLIST` is optional comma-separated extra Google addresses. Staff `@savingkc.com` logins and `savingkc@gmail.com` are already eligible.

Watch expiration is about 7 days. Connect starts a watch. The 5-minute `/api/cron/sync-gmail` cron renews it when expiration is within 6 days. Disconnect calls `users.stop` and then deletes the token row.

Apply the `gmail_push_receipts` migration before enabling the push subscription.
