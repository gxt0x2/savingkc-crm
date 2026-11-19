# Grok Build MCP

SavingKC CRM exposes an authenticated, read-only Streamable HTTP MCP server at:

```text
https://crm.savingkc.com/api/mcp
```

Register the server in Grok Build's user-scoped configuration so the connection is available from every project:

```text
grok mcp add --scope user --transport http savingkc-crm https://crm.savingkc.com/api/mcp --header "Authorization: Bearer <CRM_MCP_TOKEN>"
```

Use the same dedicated `CRM_MCP_TOKEN` as the sensitive Vercel environment variable. The server can fall back to the existing `CRM_ASSISTANT_API_SECRET` during rollout. `CRM_MCP_ACTOR_EMAIL` selects the permission-scoped CRM identity represented by the token and otherwise defaults to the configured owner.

The server exposes live CRM contact, communication, task, workflow, website-funnel, and marketing reads. Every successful or failed data read writes metadata to `assistant_query_audit`; prompts, responses, seller PII, and tokens are not written to that audit table.

CRM contact, pipeline, phone, DNC, opt-out, and TCPA records stay read-only. `crm_line_type_lookup` is the one tool that calls an external service: Twilio Lookup v2 with `Fields=line_type_intelligence`. Pass `phones`, a list of up to 200 E.164 or 10-digit US numbers. The same behavior is available as `POST /api/ops/line-type-lookup` with the CRM MCP bearer and a JSON body `{ "phones": ["8165550100"] }`. The call dedupes numbers and refuses to run when today's America/Chicago lookups would pass 1,000. It records the count in `assistant_query_audit` and does not write the phone numbers or any prospect data. Consequential CRM mutations remain behind the existing human review and approval boundary.

## Grok Bot / Cursor OAuth

Grok Bot and Cursor cloud connectors can register the same URL without a static header. The MCP protected-resource metadata points them to the SavingKC Supabase OAuth 2.1 server, where the configured CRM actor signs in and explicitly approves read-only access.

Supabase Authentication must have OAuth Server enabled with:

- Authorization path: `/oauth/consent`
- Dynamic client registration: enabled

The consent screen accepts only the documented Cursor MCP callbacks and only the identity configured by `CRM_MCP_ACTOR_EMAIL`. The authorization request is limited to the `email` scope, and Supabase-issued OAuth access tokens must contain a `client_id` plus that exact email. The original static bearer credential remains supported for Grok Build CLI.
