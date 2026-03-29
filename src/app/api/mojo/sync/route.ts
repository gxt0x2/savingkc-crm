import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { buildManifest } from '@/lib/manifest-builder'
import { detectCounty } from '@/lib/county-enrichment'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import type { ManifestV2, ManifestContact } from '@/lib/manifest-builder'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

interface MojoCallRecord {
  record_id: string
  contact_name: string
  phone_number: string
  property_address: string
  city: string
  state: string
  zip: string
  call_date: string
  call_duration: number
  disposition: string
  agent_name: string
  notes?: string
  list_name?: string
  campaign_name?: string
}

interface DispositionMapping {
  outcome: string
  priority?: 'hot' | 'warm' | 'cold'
  alertErnest?: boolean
  createAppointment?: boolean
  incrementAttempts?: boolean
  flag?: string
  isDead?: boolean
}

// Map Mojo dispositions to manifest fields
function mapDisposition(disposition: string): DispositionMapping {
  const d = disposition.toLowerCase()

  if (d.includes('callback') || d === 'callback requested') {
    return { outcome: 'callback_scheduled', priority: 'warm' }
  }
  if (d === 'interested' || d.includes('motivated')) {
    return { outcome: 'meaningful_conversation', priority: 'hot', alertErnest: true }
  }
  if (d.includes('appointment') || d === 'appointment set') {
    return { outcome: 'appointment_set', priority: 'hot', alertErnest: true, createAppointment: true }
  }
  if (d === 'not interested' || d.includes('not interested')) {
    return { outcome: 'not_interested', isDead: true }
  }
  if (d === 'wrong number') {
    return { outcome: 'wrong_number', isDead: true, flag: 're_skip_trace' }
  }
  if (d === 'disconnected') {
    return { outcome: 'disconnected', isDead: true, flag: 're_skip_trace' }
  }
  if (d === 'no answer') {
    return { outcome: 'no_answer', incrementAttempts: true }
  }
  if (d.includes('voicemail')) {
    return { outcome: 'voicemail_left', incrementAttempts: true }
  }
  if (d === 'dnc request' || d.includes('do not call')) {
    return { outcome: 'dnc', isDead: true }
  }
  if (d === 'already sold' || d.includes('sold')) {
    return { outcome: 'already_sold', isDead: true }
  }
  if (d.includes('listed') || d.includes('agent')) {
    return { outcome: 'listed', priority: 'cold' }
  }
  if (d === 'busy') {
    return { outcome: 'busy' }
  }

  return { outcome: 'other' }
}

// Normalize phone number to E164 format
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `+1${digits}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  return `+${digits}`
}

// Parse contact name into first/last
function parseContactName(fullName: string): { firstName: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: 'Unknown' }
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Send SMS alert
async function sendAlert(name: string, address: string, disposition: string, score?: number) {
  const scoreText = score ? ` Score: ${score}` : ''
  const smsText = `🔥 Hot lead from Casey: ${name} at ${address} — ${disposition}.${scoreText}`

  try {
    await twilioClient.messages.create({
      body: smsText,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: process.env.ERNEST_PHONE!,
    })
    return true
  } catch (err) {
    console.error('Failed to send alert:', err)
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const { calls } = await req.json() as { calls: MojoCallRecord[] }

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json({ error: 'calls array required' }, { status: 400 })
    }

    let processed = 0
    let created = 0
    let updated = 0
    let skipped = 0
    let alertsSent = 0

    for (const call of calls) {
      try {
        // A. Duplicate check — look for mojoRecordId in auditTrail
        // Use textSearch on the JSONB field to find the mojoRecordId
        const { data: existingManifests } = await supabase
          .from('manifests')
          .select('id')
          .ilike('manifest', `%${call.record_id}%`)
          .limit(1)

        if (existingManifests && existingManifests.length > 0) {
          skipped++
          continue
        }

        // B. Find or create manifest
        const normalizedPhone = normalizePhone(call.phone_number)

        // Search by phone in manifests
        const { data: phoneManifests } = await supabase
          .from('manifests')
          .select('id, manifest, lead_id')
          .contains('manifest->owner->phones', [normalizedPhone])
          .limit(1)

        let manifestId: string | null = null
        let manifest: ManifestV2 | null = null
        let leadId: string | null = null
        let isNew = false

        if (phoneManifests && phoneManifests.length > 0) {
          // Found existing manifest by phone
          manifestId = phoneManifests[0].id
          manifest = phoneManifests[0].manifest as ManifestV2
          leadId = phoneManifests[0].lead_id
        } else {
          // Search by phone in leads table
          const { data: phoneLeads } = await supabase
            .from('leads')
            .select('id, phone')
            .eq('phone', normalizedPhone)
            .limit(1)

          if (phoneLeads && phoneLeads.length > 0) {
            leadId = phoneLeads[0].id

            // Check if this lead has a manifest
            const { data: leadManifests } = await supabase
              .from('manifests')
              .select('id, manifest')
              .eq('lead_id', leadId)
              .limit(1)

            if (leadManifests && leadManifests.length > 0) {
              manifestId = leadManifests[0].id
              manifest = leadManifests[0].manifest as ManifestV2
            }
          }
        }

        // C. Disposition mapping
        const dispositionMap = mapDisposition(call.disposition)

        // D. Manifest update or create
        const { firstName, lastName } = parseContactName(call.contact_name)
        const now = new Date().toISOString()

        if (manifest && manifestId) {
          // Update existing manifest
          // Add phone if not already there
          const phones = manifest.owner.phones || []
          if (!phones.includes(normalizedPhone)) {
            phones.push(normalizedPhone)
          }
          manifest.owner.phones = phones

          // Update property address if provided
          if (call.property_address) {
            manifest.property.address = call.property_address
          }

          // Update priority if mapped (unless it's a dead lead)
          if (dispositionMap.priority && !dispositionMap.isDead) {
            manifest.priority = dispositionMap.priority
          } else if (dispositionMap.isDead) {
            // Dead leads get marked as cold priority
            manifest.priority = 'cold'
          }

          // Add contact entry
          const contact: ManifestContact = {
            name: call.agent_name,
            role: 'agent',
            phone: call.phone_number,
            notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
          }
          manifest.contacts.push(contact)

          // Add note if provided
          if (call.notes) {
            manifest.notes.push({
              timestamp: call.call_date,
              author: call.agent_name,
              content: call.notes,
              type: 'general',
            })
          }

          // Add flag if mapped
          if (dispositionMap.flag) {
            manifest.flags.redFlags = manifest.flags.redFlags || []
            if (!manifest.flags.redFlags.includes(dispositionMap.flag)) {
              manifest.flags.redFlags.push(dispositionMap.flag)
            }
          }

          // Add audit entry
          manifest.auditTrail.push({
            timestamp: now,
            agent: 'system:mojo-sync',
            action: 'mojo_call_synced',
            details: {
              mojoRecordId: call.record_id,
              disposition: call.disposition,
              outcome: dispositionMap.outcome,
              listName: call.list_name,
              campaign: call.campaign_name,
              callDuration: call.call_duration,
              callDate: call.call_date,
            },
          })

          manifest.lastUpdated = now
          manifest.lastUpdatedBy = 'system:mojo-sync'

          // Update in database
          await supabase
            .from('manifests')
            .update({
              manifest,
              priority: manifest.priority,
              current_station: manifest.currentStation,
            })
            .eq('id', manifestId)

          updated++
        } else {
          // Create new manifest
          const manifestInput = {
            firstName,
            lastName,
            phone: normalizedPhone,
            propertyAddress: call.property_address,
            propertyCity: call.city,
            propertyState: call.state,
            propertyZip: call.zip,
            source: `mojo:${call.list_name || 'unknown'}`,
            station: call.property_address ? 'qualification' : 'intake',
            priority: dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm'),
          }

          manifest = buildManifest(manifestInput)

          // Override default values with Mojo data
          manifest.property.address = call.property_address
          manifest.currentStation = call.property_address ? 'qualification' : 'intake'
          manifest.priority = dispositionMap.isDead ? 'cold' : (dispositionMap.priority || 'warm')

          // Add contact entry
          const contact: ManifestContact = {
            name: call.agent_name,
            role: 'agent',
            phone: call.phone_number,
            notes: `${call.disposition}${call.notes ? ` — ${call.notes}` : ''}\nDuration: ${call.call_duration}s\nDate: ${call.call_date}`,
          }
          manifest.contacts.push(contact)

          // Add note
          if (call.notes) {
            manifest.notes.push({
              timestamp: call.call_date,
              author: call.agent_name,
              content: call.notes,
              type: 'general',
            })
          }

          // Add flag if mapped
          if (dispositionMap.flag) {
            manifest.flags.redFlags = manifest.flags.redFlags || []
            manifest.flags.redFlags.push(dispositionMap.flag)
          }

          // Add audit entry
          manifest.auditTrail.push({
            timestamp: now,
            agent: 'system:mojo-sync',
            action: 'mojo_call_synced',
            details: {
              mojoRecordId: call.record_id,
              disposition: call.disposition,
              outcome: dispositionMap.outcome,
              listName: call.list_name,
              campaign: call.campaign_name,
              callDuration: call.call_duration,
              callDate: call.call_date,
            },
          })

          // Create lead if needed
          if (!leadId) {
            const { data: newLead } = await supabase
              .from('leads')
              .insert({
                full_name: call.contact_name,
                property_address: call.property_address,
                phone: normalizedPhone,
                city: call.city,
                state: call.state,
                zip: call.zip,
                source: `mojo:${call.list_name || 'unknown'}`,
                station: call.property_address ? 'qualification' : 'intake',
                priority: 'normal',
              })
              .select('id')
              .single()

            if (newLead) {
              leadId = newLead.id
            }
          }

          // Insert manifest
          const { data: newManifest } = await supabase
            .from('manifests')
            .insert({
              lead_id: leadId,
              version: manifest.version,
              manifest,
              current_station: manifest.currentStation,
              priority: manifest.priority,
            })
            .select('id')
            .single()

          if (newManifest) {
            manifestId = newManifest.id
            created++
            isNew = true
          }
        }

        // E. If new manifest with address: trigger enrichment
        if (isNew && manifest && manifestId && call.property_address && call.state) {
          try {
            const detected = detectCounty(call.city, call.state, call.zip)
            if (detected) {
              // Enrich manifest
              manifest = await enrichManifestProperty(
                manifest,
                call.property_address,
                call.city,
                call.state,
                call.zip,
                detected.county
              )

              // Score manifest
              const { score, tier } = scoreManifest(manifest)
              manifest.qualificationScore = score
              manifest.tier = tier as any

              // Update manifest in database
              await supabase
                .from('manifests')
                .update({
                  manifest,
                  qualification_score: score,
                  tier,
                })
                .eq('id', manifestId)

              // Also update leads table
              if (leadId) {
                const prop = manifest.property || {}
                const dwell = prop.dwelling || {}
                const assess = prop.assessment || {}

                const leadUpdates: Record<string, any> = {}
                if (dwell.bedrooms) leadUpdates.beds = dwell.bedrooms
                if (dwell.bathrooms) leadUpdates.baths_full = dwell.bathrooms
                if (dwell.sqft) leadUpdates.sqft = dwell.sqft
                if (dwell.yearBuilt) leadUpdates.year_built = dwell.yearBuilt
                if (assess.appraisedTotal) leadUpdates.arv = assess.appraisedTotal
                if (assess.assessedTotal) leadUpdates.assessed_value = assess.assessedTotal
                if (dwell.propertyType) {
                  leadUpdates.property_type =
                    dwell.propertyType === 'SF' ? 'Single Family' : dwell.propertyType
                }
                if (dwell.basement) leadUpdates.basement_type = dwell.basement
                if (detected.county) {
                  leadUpdates.data_source = `${detected.county.toLowerCase()}_county_assessor`
                  leadUpdates.data_enriched_at = new Date().toISOString()
                }

                if (Object.keys(leadUpdates).length > 0) {
                  await supabase.from('leads').update(leadUpdates).eq('id', leadId)
                }
              }
            }
          } catch (enrichErr) {
            console.error('Enrichment failed for call:', call.record_id, enrichErr)
          }
        }

        // F. Alerts
        if (dispositionMap.alertErnest) {
          const score = manifest?.qualificationScore
          const sent = await sendAlert(
            call.contact_name,
            call.property_address,
            call.disposition,
            score
          )
          if (sent) alertsSent++
        }

        processed++
      } catch (callErr) {
        console.error('Error processing call:', call.record_id, callErr)
      }
    }

    // G. Response
    return NextResponse.json({
      processed,
      created,
      updated,
      skipped,
      alerts_sent: alertsSent,
    })
  } catch (err) {
    console.error('Mojo sync error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
