#!/usr/bin/env node

import fs from 'fs'

const html = fs.readFileSync('/tmp/scraper-test.html', 'utf8')

// Test dt/dd parsing
const dtDdPattern = /<dt[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/dt>\s*<dd[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/dd>/gi
const fields = {}
let match
while ((match = dtDdPattern.exec(html)) !== null) {
  const label = match[1].replace(/<[^>]*>/g, '').trim()
  const value = match[2].replace(/<[^>]*>/g, '').trim()
  if (label && value) fields[label] = value
}

console.log('Fields found:', Object.keys(fields).length)
console.log('Year Built:', fields['Year Built'])
console.log('Gross Living Area:', fields['Gross Living Area'])
console.log('Style:', fields['Style'])
console.log('Bedrooms:', fields['Number of Bedrooms'])
console.log('Bathrooms:', fields['Plumbing'])
console.log('Basement:', fields['Basement Area Type'])
console.log('Lot Area:', fields['Lot Area'])

// Test valuation parsing
const flatHtml = html.replace(/\n/g, ' ')
const residentialMatch = flatHtml.match(/Residential Value.*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*)/)
console.log('\nValuation match:', residentialMatch ? 'YES' : 'NO')
if (residentialMatch) {
  console.log('  Improvements:', residentialMatch[1])
  console.log('  Land:', residentialMatch[2])
  console.log('  Total:', residentialMatch[3])
  console.log('  Assessed:', residentialMatch[4])
}
