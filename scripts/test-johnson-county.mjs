#!/usr/bin/env node

import { CountyEnrichmentService } from '../src/lib/county-enrichment.ts'

const service = new CountyEnrichmentService()

console.log('Testing Johnson County, KS enrichment...\n')

const result = await service.enrich({
  address: '12000 W 135th St',
  city: 'Overland Park',
  state: 'KS',
  zip: '66213',
  county: 'Johnson'
})

console.log('Result:', JSON.stringify(result, null, 2))

process.exit(0)
