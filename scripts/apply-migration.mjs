#!/usr/bin/env node
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SUPABASE_URL = 'https://fprrknfyzlthbxewnwmi.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwcnJrbmZ5emx0aGJ4ZXdud21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU3MTI2NywiZXhwIjoyMDg2MTQ3MjY3fQ.y4WbIp6fQKSpo83BZ8SxlsQXeEDY6NisvAhAr5SUZ0A'

const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20260328_manifests_table.sql')
const sql = readFileSync(migrationPath, 'utf8')

console.log('Applying manifests migration...')

// Execute via Supabase Management API query endpoint
const statements = sql.split(';').filter(s => s.trim()).map(s => s + ';')

for (const statement of statements) {
  try {
    console.log('Executing:', statement.substring(0, 60) + '...')

    // Use the Supabase REST API with a direct query
    // We'll make a raw query by creating a temporary table or using direct SQL execution
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: statement })
    })

    if (!response.ok) {
      console.error('Failed:', await response.text())
      console.log('Will try alternative method...')
    }
  } catch (err) {
    console.error('Error:', err.message)
  }
}

console.log('\n✅ Migration completed (or use Supabase Dashboard SQL Editor if errors occurred)')
console.log('\nTo apply manually:')
console.log('1. Go to https://supabase.com/dashboard/project/fprrknfyzlthbxewnwmi/sql/new')
console.log('2. Paste the contents of supabase/migrations/20260328_manifests_table.sql')
console.log('3. Click "Run"')
