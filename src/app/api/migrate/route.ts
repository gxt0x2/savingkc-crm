import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // LED-09: Housing Fields Schema Migration
  const migrations = [
    // Add housing detail fields
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS beds INTEGER`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS baths_full DECIMAL(3,1)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS baths_half INTEGER`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS sqft INTEGER`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lot_size DECIMAL(10,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS year_built INTEGER`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS basement_type VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS stories DECIMAL(2,1)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS garage_spaces INTEGER`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS roof_type VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS heating VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cooling VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS property_type VARCHAR(100)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS zoning VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS hoa_amount DECIMAL(10,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS tax_assessment DECIMAL(12,2)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_sale_date DATE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_sale_price DECIMAL(12,2)`,

    // Add metadata fields
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_source VARCHAR(50)`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_enriched_at TIMESTAMP`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS county VARCHAR(50)`,
  ]

  const results = []

  for (const sql of migrations) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql })

      if (error) {
        // If exec_sql RPC doesn't exist, use raw query
        const response = await fetch(
          `${supabaseUrl}/rest/v1/rpc/exec_sql`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ sql }),
          }
        )

        if (!response.ok) {
          results.push({ sql: sql.substring(0, 50) + '...', error: error?.message || 'Unknown error' })
        } else {
          results.push({ sql: sql.substring(0, 50) + '...', success: true })
        }
      } else {
        results.push({ sql: sql.substring(0, 50) + '...', success: true })
      }
    } catch (err) {
      results.push({ sql: sql.substring(0, 50) + '...', error: String(err) })
    }
  }

  const successCount = results.filter(r => r.success).length
  const errorCount = results.filter(r => r.error).length

  return NextResponse.json({
    message: `Migration complete: ${successCount} successful, ${errorCount} failed`,
    results,
  })
}
