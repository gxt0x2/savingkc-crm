#!/usr/bin/env node
// Apply a migration file via Supabase's REST API → exec_sql RPC.
// Uses the service_role JWT (already in .env.local) for auth — same channel
// the app uses to read/write. Bypasses the SQL editor parser quirks and the
// pooler auth issues entirely.
//
// Usage: node scripts/migration/apply-via-rest.mjs <file.sql>

import { readFileSync } from 'fs'

const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
if (!url || !key) {
  console.error('Missing Supabase URL or service role key in .env.local')
  process.exit(1)
}

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/migration/apply-via-rest.mjs <file.sql>')
  process.exit(1)
}

const sql = readFileSync(file, 'utf-8')

console.log(`Applying ${file}`)
console.log(`Target: ${url}`)
console.log(`Size:   ${sql.length} bytes`)
console.log('')

const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  },
  body: JSON.stringify({ sql_query: sql }),
})

const text = await res.text()
if (!res.ok) {
  console.error(`✗ HTTP ${res.status} ${res.statusText}`)
  console.error('  Response body:')
  console.error('  ' + text)
  process.exit(1)
}

console.log('✓ Migration applied.')
if (text && text !== 'null') {
  console.log('Response:', text)
}
