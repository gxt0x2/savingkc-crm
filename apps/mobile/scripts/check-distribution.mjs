import process from 'node:process'
import appConfig from '../app.json' with { type: 'json' }

const projectId = process.env.EAS_PROJECT_ID?.trim() || appConfig.expo?.extra?.eas?.projectId
const owner = process.env.EXPO_OWNER?.trim() || appConfig.expo?.owner
const requiredEnvironment = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']

const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim())
if (!projectId) missing.unshift('EAS_PROJECT_ID')
if (!owner) missing.unshift('EXPO_OWNER')
const apiBase = process.env.EXPO_PUBLIC_CRM_API_BASE_URL?.trim() || 'https://crm.savingkc.com'
if (apiBase !== 'https://crm.savingkc.com') {
  console.error(`EXPO_PUBLIC_CRM_API_BASE_URL must be https://crm.savingkc.com for production builds; received ${apiBase}.`)
  process.exit(1)
}
if (missing.length > 0) {
  console.error(`Mobile distribution is not configured. Missing: ${missing.join(', ')}.`)
  console.error('Create/link the EAS project, then add these values to the EAS production environment before building.')
  process.exit(1)
}

console.log('Mobile distribution configuration is present. No secret values were printed.')
