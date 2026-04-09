#!/usr/bin/env node

// Explore Clay County REST API response format

const BASE = 'https://gisweb.claycountymo.gov/pub/rest'
const headers = {
  Referer: 'https://gisweb.claycountymo.gov/ps/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'application/json',
}

async function main() {
  console.log('=== Exploring Clay County REST API ===\n')

  // Test 1: Search by street name "HOME"
  console.log('1. Searching situs=HOME...')
  const res1 = await fetch(`${BASE}/parcels?situs=${encodeURIComponent('HOME')}`, {
    headers, signal: AbortSignal.timeout(15000)
  })
  console.log(`   Status: ${res1.status}`)
  const data1 = await res1.json()
  console.log(`   Results: ${Array.isArray(data1) ? data1.length : 'not array'}`)
  if (Array.isArray(data1) && data1.length > 0) {
    console.log('   First result keys:', Object.keys(data1[0]).join(', '))
    console.log('   First result:', JSON.stringify(data1[0], null, 2))
    if (data1.length > 1) {
      console.log('   Second result:', JSON.stringify(data1[1], null, 2))
    }
  } else {
    console.log('   Raw response:', JSON.stringify(data1).substring(0, 500))
  }

  // Test 2: Try a different search
  console.log('\n2. Searching situs=BOND...')
  const res2 = await fetch(`${BASE}/parcels?situs=${encodeURIComponent('BOND')}`, {
    headers, signal: AbortSignal.timeout(15000)
  })
  const data2 = await res2.json()
  console.log(`   Results: ${Array.isArray(data2) ? data2.length : 'not array'}`)
  if (Array.isArray(data2) && data2.length > 0) {
    console.log('   First result:', JSON.stringify(data2[0], null, 2))
  }

  // Test 3: Try searching with house number included
  console.log('\n3. Searching situs=9823 N HOME...')
  const res3 = await fetch(`${BASE}/parcels?situs=${encodeURIComponent('9823 N HOME')}`, {
    headers, signal: AbortSignal.timeout(15000)
  })
  const data3 = await res3.json()
  console.log(`   Results: ${Array.isArray(data3) ? data3.length : 'not array'}`)
  if (Array.isArray(data3) && data3.length > 0) {
    console.log('   First result:', JSON.stringify(data3[0], null, 2))
  }

  // Test 4: Check available endpoints
  console.log('\n4. Checking /parcels endpoint root...')
  try {
    const res4 = await fetch(`${BASE}/parcels`, {
      headers, signal: AbortSignal.timeout(10000)
    })
    console.log(`   Status: ${res4.status}`)
    const text = await res4.text()
    console.log(`   Response (first 500): ${text.substring(0, 500)}`)
  } catch (err) {
    console.log(`   Error: ${err.message}`)
  }

  // Test 5: If we found a parcel, try to get its detail
  if (Array.isArray(data1) && data1.length > 0) {
    const parcel = data1[0]
    const idFields = Object.entries(parcel).filter(([k, v]) =>
      k.toLowerCase().includes('id') || k.toLowerCase().includes('parcel') || k.toLowerCase().includes('prop')
    )
    console.log('\n5. Potential ID fields:', idFields)

    // Try each ID-like field
    for (const [key, value] of idFields) {
      console.log(`\n   Trying /parcel/${value} ...`)
      try {
        const res = await fetch(`${BASE}/parcel/${value}`, {
          headers, signal: AbortSignal.timeout(10000)
        })
        console.log(`   Status: ${res.status}`)
        if (res.ok) {
          const detail = await res.json()
          console.log(`   Detail:`, JSON.stringify(detail).substring(0, 300))
        }
      } catch (err) {
        console.log(`   Error: ${err.message}`)
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
