#!/usr/bin/env node
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20260328_manifests_table.sql')
const sql = readFileSync(migrationPath, 'utf8')

console.log('⚠️  Direct PostgreSQL connection requires database password')
console.log('\nTo apply the migration manually:')
console.log('1. Go to https://supabase.com/dashboard/project/fprrknfyzlthbxewnwmi/sql/new')
console.log('2. Paste the following SQL:\n')
console.log('─'.repeat(70))
console.log(sql)
console.log('─'.repeat(70))
console.log('\n3. Click "Run" to execute')
console.log('\nAlternatively, if you have the database password:')
console.log('  Set PGPASSWORD env var and uncomment the connection code in this script')
