#!/usr/bin/env node

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Read Supabase credentials from .env.local
const envPath = process.env.HOME + '/savingkc-crm/.env.local'
const envContent = readFileSync(envPath, 'utf-8')

const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
const supabaseKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const { data: manifest } = await supabase
  .from('manifests')
  .select('*')
  .eq('lead_id', '5ad019ea-8a71-428b-b848-874f906a0fd9')
  .single()

console.log(JSON.stringify(manifest, null, 2))
