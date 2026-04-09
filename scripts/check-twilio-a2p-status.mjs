#!/usr/bin/env node
import { readFileSync } from 'fs'

const envFile = readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
})

const ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = env.TWILIO_AUTH_TOKEN

console.log('\n🔍 Checking Twilio A2P Registration Status...\n')

// Check Trust Hub Brands
console.log('Step 1: Checking Brand Registration...\n')
const brandsUrl = `https://trusthub.twilio.com/v1/TrustProducts`

const brandsResponse = await fetch(brandsUrl, {
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  }
})

if (brandsResponse.ok) {
  const brands = await brandsResponse.json()
  if (brands.trust_products && brands.trust_products.length > 0) {
    brands.trust_products.forEach(brand => {
      console.log(`Brand: ${brand.friendly_name}`)
      console.log(`  Status: ${brand.status}`)
      console.log(`  SID: ${brand.sid}`)
      console.log(`  Type: ${brand.policy_sid}`)
      console.log(`  Created: ${brand.date_created}\n`)
    })
  } else {
    console.log('❌ No brands found. You need to register your business first.\n')
  }
} else {
  console.error('❌ Could not fetch brands:', brandsResponse.status)
}

// Check Messaging Services
console.log('Step 2: Checking Messaging Services...\n')
const servicesUrl = `https://messaging.twilio.com/v1/Services`

const servicesResponse = await fetch(servicesUrl, {
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  }
})

if (servicesResponse.ok) {
  const services = await servicesResponse.json()
  if (services.services && services.services.length > 0) {
    services.services.forEach(service => {
      console.log(`Messaging Service: ${service.friendly_name}`)
      console.log(`  SID: ${service.sid}`)
      console.log(`  Status: ${service.status}`)
      console.log(`  Use Case: ${service.use_case || 'Not set'}`)
      console.log(`  Created: ${service.date_created}\n`)
    })
  } else {
    console.log('❌ No messaging services found.\n')
  }
}

// Check A2P Campaigns
console.log('Step 3: Checking Campaign Registration...\n')
const campaignsUrl = `https://messaging.twilio.com/v1/Services?PageSize=50`

const campaignsResponse = await fetch(campaignsUrl, {
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  }
})

if (campaignsResponse.ok) {
  const result = await campaignsResponse.json()
  console.log('Messaging services:', result.services?.length || 0)

  // Get detailed info for each service
  if (result.services) {
    for (const service of result.services) {
      const detailUrl = `https://messaging.twilio.com/v1/Services/${service.sid}`
      const detailResponse = await fetch(detailUrl, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
        }
      })
      if (detailResponse.ok) {
        const detail = await detailResponse.json()
        console.log(`\nService: ${detail.friendly_name}`)
        console.log(`  Use Case: ${detail.use_case}`)
        console.log(`  US A2P Campaign SID: ${detail.us_app_to_person_campaign_sid || 'Not registered'}`)
      }
    }
  }
}

console.log('\n─'.repeat(80))
console.log('\n📋 Next Steps:\n')
console.log('1. Go to: https://console.twilio.com/us1/develop/sms/settings/a2p-registration')
console.log('2. Check the campaign error details')
console.log('3. Click "View Details" on the failed campaign to see why it failed')
console.log('')
