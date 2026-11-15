import { pathToFileURL } from 'node:url'
import { env, git, isTestFile, repoFromOrigin, upsertSticky } from './github-api.mjs'

export const sizeMarker = '<!-- pr-size-gate -->'
export const acceptanceMarker = '<!-- pr-acceptance-checks -->'
export const warnAbove = 400
export const failAbove = 800
export function isExcludedFromSize(file) {
  const name = String(file).replaceAll('\\', '/')
  if (isTestFile(name)) return true
  if (/(^|\/)__fixtures__\//.test(name) || /(^|\/)fixtures\//.test(name)) return true
  if (/\.fixture\.[cm]?[jt]sx?$/.test(name)) return true
  if (/(^|\/)docs\//.test(name) || /\.md$/i.test(name)) return true
  if (/(^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|npm-shrinkwrap\.json)$/.test(name)) {
    return true
  }
  if (/(^|\/)generated\//.test(name) || /\.generated\./.test(name) || name.endsWith('.snap')) return true
  if (/(^|\/)coverage\//.test(name) || name.endsWith('.min.js') || /(^|\/)next-env\.d\.ts$/.test(name)) return true
  return false
}

export function countChangedLines(numstat) {
  let total = 0
  for (const line of String(numstat).split('\n')) {
    if (!line.trim()) continue
    const [added, deleted, file] = line.split('\t')
    if (!file || added === '-' || deleted === '-') continue
    if (isExcludedFromSize(file)) continue
    total += Number(added) + Number(deleted)
  }
  return total
}

export function sizeDecision(total, labels) {
  const approved = labels.has('large-pr-approved')
  return { warn: total > warnAbove, fail: total > failAbove && !approved }
}

export function acceptanceText(body) {
  if (!body) return ''
  const match = /^##\s+Acceptance checks\s*$/im.exec(body)
  if (!match) return ''
  const rest = body.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(rest)
  const section = next ? rest.slice(0, next.index) : rest
  return section
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== '-' && line !== '*' && line !== '_TBD_')
    .join('\n')
}

export function diffNumstat(root, base) {
  try {
    return git(['diff', '--numstat', `${base}...HEAD`], root)
  } catch {
    return git(['diff', '--numstat', base, 'HEAD'], root)
  }
}

function sizeComment(total, hard) {
  const hardLine = hard ? '\n\nAbove 800 changed lines, the check fails unless the PR has the `large-pr-approved` label.' : ''
  return `${sizeMarker}\n## This PR is large enough to split\n\nChanged lines outside tests, fixtures, lockfiles, generated files, and docs: **${total}**.\n\nSplit the change so a reviewer can finish it in one round. The warning line is 400 changed lines.${hardLine}\n`
}

function acceptanceComment() {
  return `${acceptanceMarker}\n## Acceptance checks are empty\n\nWrite the exact commands or queries under **Acceptance checks**, and the result each one should return. This is a warning.\n`
}

export async function runSizeGate({
  repo,
  prNumber,
  total,
  labels,
  body,
  mode = 'all',
  log = console.log,
  error = console.error,
}) {
  const decision = sizeDecision(total, labels)
  if (mode !== 'acceptance') {
    await upsertSticky(repo, prNumber, sizeMarker, decision.warn ? sizeComment(total, total > failAbove) : '')
    log(`Changed lines: ${total}.`)
  }
  if (mode !== 'size') {
    const acceptance = acceptanceText(body)
    await upsertSticky(repo, prNumber, acceptanceMarker, acceptance ? '' : acceptanceComment())
    log(acceptance ? 'Acceptance checks section has content.' : 'Acceptance checks section is empty. Warning posted.')
  }
  if (mode !== 'acceptance' && decision.fail) {
    error(`Changed lines ${total} exceed ${failAbove} without the large-pr-approved label.`)
    return 1
  }
  if (mode !== 'acceptance') {
    log(decision.warn ? 'PR size gate passed with a split warning.' : 'PR size gate passed.')
  }
  return 0
}

async function cli() {
  const repo = repoFromOrigin()
  const prNumber = env('PR_NUMBER')
  const base = env('BASE_SHA')
  if (!repo || !prNumber || !base) throw new Error('PR_NUMBER, BASE_SHA, and GITHUB_REPOSITORY are required.')
  const mode = process.argv.includes('--acceptance-only')
    ? 'acceptance'
    : process.argv.includes('--size-only')
      ? 'size'
      : 'all'
  const total = mode === 'acceptance' ? 0 : countChangedLines(diffNumstat(process.cwd(), base))
  const labels = new Set(
    env('PR_LABELS')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
  )
  const code = await runSizeGate({
    repo,
    prNumber,
    total,
    labels,
    body: env('PR_BODY'),
    mode,
  })
  if (code !== 0) process.exitCode = code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
