# Grok Build MCP

SavingKC CRM exposes an authenticated, read-only Streamable HTTP MCP server at:

```text
https://crm.savingkc.com/api/mcp
```

The repository's `.grok/config.toml` registers the server as `savingkc-crm` and reads its bearer token from `CRM_MCP_TOKEN`. The same token must be configured as a sensitive Vercel environment variable. `CRM_MCP_ACTOR_EMAIL` selects the permission-scoped CRM identity represented by that token.

The server exposes live CRM contact, communication, task, workflow, website-funnel, and marketing reads. Every successful or failed data read writes metadata to `assistant_query_audit`; prompts, responses, seller PII, and tokens are not written to that audit table.

All MCP tools are read-only. Consequential CRM mutations remain behind the existing human review and approval boundary.
