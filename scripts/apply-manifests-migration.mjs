import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const supabaseUrl = 'https://fprrknfyzlthbxewnwmi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwcnJrbmZ5emx0aGJ4ZXdud21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU3MTI2NywiZXhwIjoyMDg2MTQ3MjY3fQ.y4WbIp6fQKSpo83BZ8SxlsQXeEDY6NisvAhAr5SUZ0A'

const supabase = createClient(supabaseUrl, supabaseKey)

const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20260328_manifests_table.sql')
const sql = readFileSync(migrationPath, 'utf8')

console.log('Applying manifests migration...')
console.log('SQL:', sql)

// Supabase doesn't support raw SQL execution via the JS client for DDL
// We need to use the REST API with the service role key
const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  },
  body: JSON.stringify({ query: sql })
})

if (!response.ok) {
  console.error('Failed to apply migration:', await response.text())
  process.exit(1)
}

console.log('✅ Migration applied successfully')
