import {
  deterministicRepeatability,
  evaluateDeterministicFixtures,
  expandSeedFixtures,
  fixtureSetHash,
  loadSeedFixtures,
} from '../../src/lib/email/ai/evaluations'

const seed = evaluateDeterministicFixtures()
const expanded = evaluateDeterministicFixtures(expandSeedFixtures())
const failed = [...seed, ...expanded].filter((c) => !c.passed)
const report = {
  kind: 'deterministic',
  modelBacked: false,
  fixtureSetHash: fixtureSetHash(),
  seedCount: loadSeedFixtures().length,
  seedPassed: seed.every((c) => c.critical ? c.passed : true) && seed.every((c) => c.passed),
  expandedCount: expanded.length,
  expandedFailed: expanded.filter((c) => !c.passed).map((c) => c.id),
  criticalFailed: seed.filter((c) => c.critical && !c.passed).length,
  repeatability: deterministicRepeatability(),
  billedAttempts: 0,
  failedIds: failed.map((c) => c.id),
}
console.log(JSON.stringify(report, null, 2))
if (
  report.criticalFailed > 0 ||
  !report.seedPassed ||
  report.expandedFailed.length > 0
)
  process.exit(1)
