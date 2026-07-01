#!/usr/bin/env node
/**
 * Robust migration runner.
 * Applies a .sql file (or all pending files) against DATABASE_URL using the
 * `postgres` driver, executing the whole file in one call so that functions,
 * triggers, and dollar-quoted bodies with embedded semicolons work correctly.
 *
 * Usage:
 *   node scripts/migrate.mjs supabase/migrations/20260701_foo.sql   # one file
 *   node scripts/migrate.mjs --all                                  # every *.sql in migrations, sorted
 *
 * Tracks applied files in a `_migrations` table so --all is idempotent.
 */
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')

// Load DATABASE_URL from env or .env.local
function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^DATABASE_URL=(.*)$/)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
  return null
}

const DATABASE_URL = loadDbUrl()
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (env or .env.local)')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} })

async function ensureTracking() {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`
}

async function applyFile(path) {
  const name = basename(path)
  const body = readFileSync(path, 'utf8')
  console.log(`\n→ Applying ${name} ...`)
  await sql.unsafe(body)
  await sql`INSERT INTO _migrations (filename) VALUES (${name})
            ON CONFLICT (filename) DO NOTHING`
  console.log(`  ✓ ${name} applied`)
}

async function main() {
  await ensureTracking()
  const arg = process.argv[2]

  if (arg === '--all') {
    const applied = new Set(
      (await sql`SELECT filename FROM _migrations`).map((r) => r.filename)
    )
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    let ran = 0
    for (const f of files) {
      if (applied.has(f)) continue
      await applyFile(join(MIGRATIONS_DIR, f))
      ran++
    }
    console.log(`\nDone. ${ran} new migration(s) applied.`)
  } else if (arg) {
    const path = arg.startsWith('/') ? arg : join(process.cwd(), arg)
    await applyFile(path)
    console.log('\nDone.')
  } else {
    console.error('Usage: node scripts/migrate.mjs <file.sql> | --all')
    process.exit(1)
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\n✗ Migration failed:', err.message)
    await sql.end()
    process.exit(1)
  })
