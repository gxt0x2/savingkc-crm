import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const statsPath = path.join(process.cwd(), '.next', 'diagnostics', 'route-bundle-stats.json')
if (!existsSync(statsPath)) {
  console.error('Missing .next/diagnostics/route-bundle-stats.json. Run npm run build first.')
  process.exit(1)
}

const routeBudgets = new Map([
  // These are tight ratchets over the optimized production bundles—not broad
  // theoretical limits. A route must earn any future increase explicitly.
  ['/dashboard', 218 * 1024],
  ['/contacts', 232 * 1024],
  ['/conversations', 220 * 1024],
  ['/calendar', 205 * 1024],
  ['/tasks', 207 * 1024],
  ['/my-day', 212 * 1024],
  ['/checklist', 201 * 1024],
  ['/scorecard', 202 * 1024],
  ['/settings', 202 * 1024],
  ['/reports/acquisitions', 218 * 1024],
  ['/dialer', 222 * 1024],
])

const stats = JSON.parse(readFileSync(statsPath, 'utf8'))
const results = []
const failures = []

const iconFontPath = path.join(process.cwd(), 'public', 'fonts', 'material-symbols-savingkc.ttf')
const iconFontBudget = 75 * 1024
if (!existsSync(iconFontPath)) {
  failures.push('local Material Symbols subset is missing')
} else if (statSync(iconFontPath).size > iconFontBudget) {
  failures.push(`local Material Symbols subset is ${(statSync(iconFontPath).size / 1024).toFixed(1)} KiB; budget is 75 KiB`)
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(candidate)
    return /\.(?:css|js|jsx|ts|tsx)$/.test(entry.name) ? [candidate] : []
  })
}

for (const sourcePath of sourceFiles(path.join(process.cwd(), 'src'))) {
  const source = readFileSync(sourcePath, 'utf8')
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(source)) {
    failures.push(`${path.relative(process.cwd(), sourcePath)}: external Google font request is forbidden`)
  }
}

for (const [route, budget] of routeBudgets) {
  const entry = stats.find((candidate) => candidate.route === route)
  if (!entry) {
    failures.push(`${route}: build stats missing`)
    continue
  }
  const gzipBytes = entry.firstLoadChunkPaths.reduce((total, chunkPath) => {
    if (!existsSync(chunkPath)) {
      failures.push(`${route}: missing chunk ${chunkPath}`)
      return total
    }
    return total + gzipSync(readFileSync(chunkPath)).byteLength
  }, 0)
  results.push({ route, gzipBytes, budgetBytes: budget, pass: gzipBytes <= budget })
  if (gzipBytes > budget) failures.push(`${route}: ${(gzipBytes / 1024).toFixed(1)} KiB gzip exceeds ${(budget / 1024).toFixed(0)} KiB`)
}

const reportDir = path.join(process.cwd(), 'test-results', 'performance')
mkdirSync(reportDir, { recursive: true })
writeFileSync(path.join(reportDir, 'bundle-budget.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`)

console.table(results.map(({ route, gzipBytes, budgetBytes, pass }) => ({
  route,
  gzipKiB: (gzipBytes / 1024).toFixed(1),
  budgetKiB: (budgetBytes / 1024).toFixed(0),
  pass,
})))

if (failures.length > 0) {
  console.error(`Performance bundle gate failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Performance bundle gate passed.')
