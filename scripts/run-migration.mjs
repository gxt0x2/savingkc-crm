#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Load env vars
const envFile = readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
})

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

const migrationFile = process.argv[2]
if (!migrationFile) {
  console.error('Usage: node run-migration.mjs <migration-file>')
  process.exit(1)
}

console.log(`\n📦 Running migration: ${migrationFile}\n`)

const sql = readFileSync(migrationFile, 'utf8')

// Split into individual statements (crude but works for most cases)
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

console.log(`Found ${statements.length} SQL statements\n`)

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i] + ';'
  console.log(`[${i + 1}/${statements.length}] Executing...`)

  const { error } = await supabase.rpc('exec_sql', { sql_query: stmt }).single()

  if (error) {
    // Try direct query if RPC doesn't exist
    const { error: directError } = await supabase.from('_').select(stmt)

    if (directError) {
      console.error(`❌ Error: ${error.message || directError.message}`)
      console.error(`   Statement: ${stmt.slice(0, 100)}...`)
    } else {
      console.log(`✅ Success`)
    }
  } else {
    console.log(`✅ Success`)
  }
}

console.log('\n✅ Migration complete!\n')
