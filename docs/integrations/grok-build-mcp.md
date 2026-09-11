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

All MCP tools are read-only. Consequential CRM mutations remain behind the existing human review and approval boundary.

## Grok Bot / Cursor OAuth

Grok Bot and Cursor cloud connectors can register the same URL without a static header. The MCP protected-resource metadata points them to the SavingKC Supabase OAuth 2.1 server, where the configured CRM actor signs in and explicitly approves read-only access.

Supabase Authentication must have OAuth Server enabled with:

- Authorization path: `/oauth/consent`
- Dynamic client registration: enabled

The consent screen accepts only the documented Cursor MCP callbacks and only the identity configured by `CRM_MCP_ACTOR_EMAIL`. The authorization request is limited to the `email` scope, and Supabase-issued OAuth access tokens must contain a `client_id` plus that exact email. The original static bearer credential remains supported for Grok Build CLI.
