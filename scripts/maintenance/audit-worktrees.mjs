#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
const mainRef = process.env.WORKTREE_AUDIT_MAIN_REF || 'origin/main'
const currentWorktree = realpathSync(process.cwd())
git(['rev-parse', '--verify', `${mainRef}^{commit}`])

const records = git(['worktree', 'list', '--porcelain'])
  .split(/\n\n+/)
  .map((block) => Object.fromEntries(
    block.split('\n').filter(Boolean).map((line) => {
      const separator = line.indexOf(' ')
      return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)]
    }),
  ))
  .filter((record) => typeof record.worktree === 'string')

const rows = records.map((record) => {
  const path = record.worktree
  const head = typeof record.HEAD === 'string' ? record.HEAD : ''
  const branch = typeof record.branch === 'string'
    ? record.branch.replace(/^refs\/heads\//, '')
    : '(detached)'
  const present = existsSync(path)
  const current = present && realpathSync(path) === currentWorktree
  const clean = present && git(['status', '--porcelain'], path) === ''
  let merged = false

  if (head) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', head, mainRef], {
        cwd: path,
        stdio: 'ignore',
      })
      merged = true
    } catch {
      merged = false
    }
  }

  const classification = current
    ? 'current'
    : clean && merged
    ? 'safe-candidate'
    : !clean
      ? 'dirty-review'
      : 'unmerged-review'

  return { path, branch, head: head.slice(0, 12), present, current, clean, merged, classification }
})

const safeCandidates = rows.filter((row) => row.classification === 'safe-candidate')
const reviewRequired = rows.filter((row) => !['safe-candidate', 'current'].includes(row.classification))

console.table(rows)
console.log(JSON.stringify({
  gitCommonDirectory: commonDir,
  mainRef,
  worktrees: rows.length,
  safeCandidates: safeCandidates.length,
  reviewRequired: reviewRequired.length,
  note: 'This command is read-only. Only safe-candidate worktrees are clean, merged into main, and not the current worktree.',
}, null, 2))
