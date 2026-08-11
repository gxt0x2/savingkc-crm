import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')

const forbiddenPatterns = [
  /\bqualified leads?\b/i,
  /\bqualified crm stage\b/i,
  /\bof qualified\b/i,
  /\bqualified sellers?\b/i,
  /\bmarked qualified\b/i,
  /\blead qualification rate\b/i,
  /\bhas not been qualified\b/i,
  /label\s*[:=]\s*['"`]Qualified(?:\s*\(period\))?['"`]/i,
  />\s*Qualified\s*</i,
]

const intentionalExternalNames = new Map([
  ['src/lib/ppc/google-ads-conversion-actions.ts', ["name: 'Search 2026 - Qualified Lead'"]],
])

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      files.push(...sourceFiles(absolutePath))
      continue
    }

    const relativePath = path.relative(root, absolutePath)
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue
    if (relativePath.includes('/__tests__/') || relativePath.includes('/__fixtures__/') || relativePath.includes('/__snapshots__/')) continue
    files.push(relativePath)
  }
  return files
}

const violations = []

for (const relativePath of sourceFiles(sourceRoot)) {
  const allowedFragments = intentionalExternalNames.get(relativePath) ?? []
  const lines = readFileSync(path.join(root, relativePath), 'utf8').split('\n')

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (allowedFragments.some((fragment) => line.includes(fragment))) return

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        violations.push(`${relativePath}:${index + 1}: ${trimmed}`)
        break
      }
    }
  })
}

if (violations.length > 0) {
  console.error('Opportunity terminology gate failed. Present seller-stage terminology as Opportunity; keep qualified only as an internal compatibility key.')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Opportunity terminology gate passed: seller-stage labels use Opportunity while compatibility identifiers remain intact.')
