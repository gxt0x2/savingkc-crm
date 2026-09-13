# Email database connection modes

Email routes do not borrow CRM or Supabase credentials from another module. They use only `EMAIL_DATABASE_URL`.

| Environment | Mode | Database | Notes |
| --- | --- | --- | --- |
| Local simulation / harness | `EMAIL_WORKFLOW_MODE=simulation` | `EMAIL_DATABASE_URL` | `pilotDatabase()` only. Disposable or local Postgres. |
| Hosted CRM | `EMAIL_WORKFLOW_MODE=hosted` | `EMAIL_DATABASE_URL` | Atlas pooler. `emailDatabase()` for webhook intake, connections, and domains. |

Never set `EMAIL_WORKFLOW_MODE=simulation` in production. Missing hosted mode or URL returns `EMAIL_HOSTED_SETUP_REQUIRED` (503). Missing simulation setup still returns `EMAIL_SETUP_REQUIRED` (503).

Workers and live send stay off: do not enable `EMAIL_DISPATCH_WORKER_ENABLED`, `EMAIL_RECEIVING_WORKER_ENABLED`, `EMAIL_LIVE_DISPATCH_ENABLED`, `EMAIL_CONTROLLED_PROVIDER_EVIDENCE`, or `EMAIL_AI_ENABLED`. The receiving worker route remains on `pilotDatabase()`. Ernest/Robin set `EMAIL_DATABASE_URL` after merge; this document does not invent a secret.
