import { pathToFileURL } from 'node:url'
import {
  addLabel,
  env,
  githubPages,
  isDependabot,
  isTestFile,
  removeLabel,
  repoFromOrigin,
  upsertSticky,
  workstream,
} from './github-api.mjs'

export const marker = '<!-- pr-overlap-guard -->'
const duplicateLabel = {
  name: 'possible-duplicate',
  color: 'fbca04',
  description: 'Open pull request overlaps another workstream, file set, or migration name.',
}

export function migrationFileName(file) {
  const name = String(file).replaceAll('\\', '/')
  const markerIndex = name.lastIndexOf('supabase/migrations/')
  if (markerIndex === -1 || !name.endsWith('.sql')) return null
  return name.slice(markerIndex + 'supabase/migrations/'.length)
}

export function findOverlaps(current, others) {
  const mine = current.files ?? []
  const mineNonTest = mine.filter((file) => !isTestFile(file))
  const mineMigrations = new Set(mine.map(migrationFileName).filter(Boolean))
  const key = workstream(current.head)
  const overlaps = []
  for (const other of others) {
    if (Number(other.number) === Number(current.number) || isDependabot(other)) continue
    const reasons = []
    const files = []
    const otherKey = workstream(other.head?.ref ?? other.head)
    if (key && otherKey === key) reasons.push(`same workstream \`${key}\``)
    const theirs = new Set(other.files ?? [])
    const shared = mineNonTest.filter((file) => theirs.has(file))
    if (mineNonTest.length > 0 && shared.length / mineNonTest.length >= 0.5) {
      const percent = Math.round((shared.length / mineNonTest.length) * 100)
      reasons.push(`${shared.length}/${mineNonTest.length} non-test files (${percent}%)`)
      files.push(...shared)
    }
    for (const file of other.files ?? []) {
      const migration = migrationFileName(file)
      if (!migration || !mineMigrations.has(migration)) continue
      reasons.push(`migration file \`${migration}\``)
      if (!files.includes(file)) files.push(file)
    }
    if (reasons.length === 0) continue
    overlaps.push({
      number: other.number,
      title: other.title ?? '',
      reasons,
      files,
    })
  }
  return overlaps
}

export function overlapComment(overlaps) {
  const lines = [
    marker,
    '## Possible duplicate work',
    '',
    'Another open pull request matches this head-branch workstream, at least half of this PR\'s changed non-test files, or a supabase/migrations file name. This is a warning.',
    '',
  ]
  for (const overlap of overlaps) {
    const shown = overlap.files.slice(0, 30).map((file) => `\`${file}\``)
    const extra = overlap.files.length - shown.length
    const files = shown.length ? `\n  - Files: ${shown.join(', ')}${extra > 0 ? `, and ${extra} more` : ''}` : ''
    lines.push(`- #${overlap.number} ${overlap.title}: ${overlap.reasons.join('; ')}${files}`)
  }
  return `${lines.join('\n')}\n`
}

export async function runOverlapGuard({ repo, prNumber, log = console.log }) {
  const pulls = await githubPages(`/repos/${repo}/pulls?state=open`)
  const current = pulls.find((pull) => Number(pull.number) === Number(prNumber))
  if (!current) throw new Error(`PR #${prNumber} is not in the open pull request list.`)
  if (isDependabot(current)) {
    log('Dependabot pull request. Overlap guard skipped.')
    return []
  }
  const described = []
  for (const pull of pulls) {
    if (isDependabot(pull)) continue
    const files = await githubPages(`/repos/${repo}/pulls/${pull.number}/files`)
    described.push({
      number: pull.number,
      title: pull.title,
      head: pull.head?.ref ?? '',
      user: pull.user,
      files: files.map((file) => file.filename),
    })
  }
  const currentDescribed = described.find((pull) => Number(pull.number) === Number(prNumber))
  const overlaps = findOverlaps(currentDescribed, described)
  if (overlaps.length === 0) {
    await upsertSticky(repo, prNumber, marker, '')
    await removeLabel(repo, prNumber, duplicateLabel.name)
    log('No overlapping open pull requests.')
    return overlaps
  }
  await upsertSticky(repo, prNumber, marker, overlapComment(overlaps))
  await addLabel(repo, prNumber, duplicateLabel.name, duplicateLabel)
  log(`Overlap warning posted for ${overlaps.map((item) => `#${item.number}`).join(', ')}.`)
  return overlaps
}

async function cli() {
  const repo = repoFromOrigin()
  const prNumber = env('PR_NUMBER')
  if (!repo || !prNumber) throw new Error('PR_NUMBER and GITHUB_REPOSITORY are required.')
  await runOverlapGuard({ repo, prNumber })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
