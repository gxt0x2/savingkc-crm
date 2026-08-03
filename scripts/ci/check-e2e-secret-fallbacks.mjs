import fs from 'node:fs'
import path from 'node:path'

const roots = ['tests', 'playwright.config.ts']
const forbidden = [
  /CRM_E2E_EMAIL\s*\?\?\s*['"`]/,
  /CRM_E2E_PASSWORD\s*\?\?\s*['"`]/,
]

function filesUnder(entry) {
  if (!fs.existsSync(entry)) return []
  const stat = fs.statSync(entry)
  if (stat.isFile()) return [entry]
  return fs.readdirSync(entry, { withFileTypes: true }).flatMap((child) => {
    const childPath = path.join(entry, child.name)
    return child.isDirectory() ? filesUnder(childPath) : [childPath]
  })
}

const violations = roots
  .flatMap(filesUnder)
  .filter((file) => /\.(?:[cm]?[jt]sx?|json)$/.test(file))
  .filter((file) => forbidden.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8'))))

if (violations.length > 0) {
  console.error('Hardcoded CRM E2E credential fallbacks are forbidden:')
  violations.forEach((file) => console.error(`- ${file}`))
  process.exit(1)
}

console.log('E2E credential gate passed: credentials are environment-only.')
