import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const coveragePath = path.join(repoRoot, 'coverage', 'coverage-final.json')
const bottleneckPath = 'src/app/(app)/dashboard/lib/bottleneck.ts'
const componentsDir = 'src/app/(app)/dashboard/components'
const bottleneckMinimum = 100
const componentMinimum = 90

if (!fs.existsSync(coveragePath)) {
  console.error(`Missing coverage report at ${coveragePath}. Run npm run test:coverage first.`)
  process.exit(1)
}

const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'))
const coverageByRelativePath = new Map()

for (const [filePath, fileCoverage] of Object.entries(coverage)) {
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/')
  coverageByRelativePath.set(relativePath, fileCoverage)
}

const failures = []

const bottleneckAbsolutePath = path.join(repoRoot, bottleneckPath)
if (fs.existsSync(bottleneckAbsolutePath)) {
  assertFileCoverage(bottleneckPath, bottleneckMinimum, failures)
} else {
  console.log(`KPI bottleneck gate armed: ${bottleneckPath} is not present yet.`)
}

const componentFiles = listComponentFiles(path.join(repoRoot, componentsDir))
if (componentFiles.length > 0) {
  assertAggregateCoverage(componentFiles, componentMinimum, failures)
} else {
  console.log(`KPI component gate armed: ${componentsDir} has no component files yet.`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure)
  }

  process.exit(1)
}

console.log('KPI coverage gates passed.')

function assertFileCoverage(relativePath, minimum, output) {
  const metrics = getFileMetrics(relativePath)

  for (const [metric, value] of Object.entries(metrics)) {
    if (value < minimum) {
      output.push(`${relativePath} ${metric} coverage is ${formatPercent(value)}; required ${minimum}%.`)
    }
  }
}

function assertAggregateCoverage(relativePaths, minimum, output) {
  const aggregate = createEmptyCounters()

  for (const relativePath of relativePaths) {
    addCounters(aggregate, getFileCounters(relativePath))
  }

  const metrics = countersToMetrics(aggregate)

  for (const [metric, value] of Object.entries(metrics)) {
    if (value < minimum) {
      output.push(`${componentsDir} aggregate ${metric} coverage is ${formatPercent(value)}; required ${minimum}%.`)
    }
  }
}

function getFileMetrics(relativePath) {
  return countersToMetrics(getFileCounters(relativePath))
}

function getFileCounters(relativePath) {
  const fileCoverage = coverageByRelativePath.get(relativePath)

  if (!fileCoverage) {
    return emptyFileCountersFromSource(relativePath)
  }

  return {
    statements: countObjectHits(fileCoverage.s),
    functions: countObjectHits(fileCoverage.f),
    branches: countBranchHits(fileCoverage.b),
    lines: countLineHits(fileCoverage.statementMap, fileCoverage.s),
  }
}

function emptyFileCountersFromSource(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)

  if (!fs.existsSync(absolutePath)) {
    return createEmptyCounters()
  }

  return {
    statements: { covered: 0, total: 1 },
    functions: { covered: 0, total: 1 },
    branches: { covered: 0, total: 1 },
    lines: { covered: 0, total: countSourceLines(absolutePath) },
  }
}

function listComponentFiles(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      return listComponentFiles(absolutePath)
    }

    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) {
      return []
    }

    return [path.relative(repoRoot, absolutePath).split(path.sep).join('/')]
  })
}

function createEmptyCounters() {
  return {
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  }
}

function addCounters(target, source) {
  for (const metric of Object.keys(target)) {
    target[metric].covered += source[metric].covered
    target[metric].total += source[metric].total
  }
}

function countersToMetrics(counters) {
  return Object.fromEntries(
    Object.entries(counters).map(([metric, counter]) => [metric, toPercent(counter.covered, counter.total)]),
  )
}

function countObjectHits(counts = {}) {
  const values = Object.values(counts)

  return {
    covered: values.filter((value) => value > 0).length,
    total: values.length,
  }
}

function countBranchHits(counts = {}) {
  const values = Object.values(counts).flat()

  return {
    covered: values.filter((value) => value > 0).length,
    total: values.length,
  }
}

function countLineHits(statementMap = {}, statementCounts = {}) {
  const lines = new Map()

  for (const [statementId, statement] of Object.entries(statementMap)) {
    const line = statement?.start?.line

    if (typeof line !== 'number') {
      continue
    }

    const current = lines.get(line) ?? false
    lines.set(line, current || (statementCounts[statementId] ?? 0) > 0)
  }

  return {
    covered: Array.from(lines.values()).filter(Boolean).length,
    total: lines.size,
  }
}

function countSourceLines(absolutePath) {
  return fs
    .readFileSync(absolutePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length || 1
}

function toPercent(covered, total) {
  if (total === 0) {
    return 100
  }

  return (covered / total) * 100
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`
}
