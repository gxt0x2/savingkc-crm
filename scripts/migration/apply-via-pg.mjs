#!/usr/bin/env node
// Apply a Supabase migration file over a direct Postgres connection,
// bypassing Supabase Studio's SQL editor. Studio's editor/proxy mangles
// PL/pgSQL function bodies on paste; a direct `postgres`-package connection
// sends the full SQL as one session and variable binding works correctly.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/migration/apply-via-pg.mjs <file.sql>
//   (or put DATABASE_URL in .env.local)
//
// The file is applied as a single transaction; any error rolls back.

import { readFileSync } from 'fs'
import postgres from 'postgres'

let DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  try {
    const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
    const match = env.match(/^DATABASE_URL=(.+)$/m)
    if (match) DATABASE_URL = match[1].trim()
  } catch {
    // fall through
  }
}

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.')
  console.error('Add it to .env.local (no quotes) or export it in your shell.')
  console.error('Get it from Supabase dashboard → Project Settings → Database')
  console.error('→ Connection string → "Direct connection" (port 5432).')
  process.exit(1)
}

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/migration/apply-via-pg.mjs <file.sql>')
  process.exit(1)
}

const sql = readFileSync(file, 'utf-8')

// Parse the URL manually so tenant-in-username (e.g. postgres.PROJECTREF used
// by Supabase's Supavisor pooler) is preserved. Some URL parsers strip after
// the first dot.
const u = new URL(DATABASE_URL)
const user = decodeURIComponent(u.username)
const password = decodeURIComponent(u.password)

const client = postgres({
  host: u.hostname,
  port: Number(u.port || 5432),
  database: u.pathname.slice(1) || 'postgres',
  user,
  password,
  max: 1,
  prepare: false,
  connection: { application_name: 'v2-1-migration' },
  onnotice: (n) => console.log(`NOTICE: ${n.message}`),
  ssl: 'require',
})

console.log(`Applying ${file}`)
console.log(`Target: ${u.host}`)
console.log(`User:   ${user}`)
console.log(`Pass:   ${password.replace(/./g, '*').slice(0, 5)}... (${password.length} chars)`)
console.log(`Size:   ${sql.length} bytes`)
console.log('')

try {
  // Apply the whole file as unsafe (no parameter substitution) in one call.
  // The `postgres` package handles multi-statement strings correctly — it does
  // NOT split on `;`, it hands the whole blob to the Postgres wire protocol.
  await client.unsafe(sql)
  console.log('\n✓ Migration applied successfully.')
} catch (err) {
  console.error('\n✗ Migration failed:')
  console.error('  ' + (err.message || err))
  if (err.position) console.error('  at position ' + err.position)
  if (err.detail)   console.error('  detail: '   + err.detail)
  if (err.hint)     console.error('  hint: '     + err.hint)
  if (err.where)    console.error('  where: '    + err.where)
  process.exit(1)
} finally {
  await client.end({ timeout: 2 })
}
