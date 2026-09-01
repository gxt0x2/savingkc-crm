#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const manifestPath = path.join(root, '.crm-canonical.json')

function fail(message) {
  failures.push(message)
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

if (!existsSync(manifestPath)) {
  fail('Missing .crm-canonical.json. This checkout is not approved for CRM deployment.')
}

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : {}

if (manifest.repository !== 'gxt0x2/savingkc-crm') fail('Canonical repository identity is incorrect.')
if (manifest.canonicalBranch !== 'main') fail('Canonical production branch must be main.')
if (manifest.vercelProjectId !== 'prj_NOdFDJ328LIAGbIdQ7wwZnMFQTq2') fail('Canonical Vercel project ID is incorrect.')
if (manifest.vercelProjectName !== 'savingkc-crm') fail('Canonical Vercel project name is incorrect.')
if (manifest.routes?.pipeline !== '/contacts?list=contacted') fail('Canonical Pipeline route must be /contacts?list=contacted.')

const pipelineRoute = 'src/app/(app)/pipeline/page.tsx'
if (!existsSync(path.join(root, pipelineRoute))) {
  fail(`Missing legacy-route quarantine at ${pipelineRoute}.`)
} else {
  const source = read(pipelineRoute)
  if (!source.includes("redirect('/contacts?list=contacted')")) fail('Legacy /pipeline must redirect to /contacts?list=contacted.')
  if (source.includes('Stage Management')) fail('Retired Stage Management interface is still deployable.')
}

const workspaceNav = 'src/components/conversations/workspace-nav.tsx'
if (!existsSync(path.join(root, workspaceNav)) || !read(workspaceNav).includes("href: '/contacts?list=contacted'")) {
  fail('Workspace Pipeline navigation is not pinned to /contacts?list=contacted.')
}

const vercelProjectPath = path.join(root, '.vercel/project.json')
if (existsSync(vercelProjectPath)) {
  const project = JSON.parse(readFileSync(vercelProjectPath, 'utf8'))
  const projectIdMismatch = project.projectId !== manifest.vercelProjectId
  const projectNameMismatch = Boolean(project.projectName) && project.projectName !== manifest.vercelProjectName
  if (projectIdMismatch || projectNameMismatch) {
    fail(`This checkout is linked to Vercel project ${project.projectName || project.projectId}, not ${manifest.vercelProjectName}.`)
  }
}

if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== manifest.vercelProjectId) {
  fail(`Vercel project mismatch: ${process.env.VERCEL_PROJECT_ID}.`)
}
if (process.env.VERCEL_GIT_REPO_SLUG && process.env.VERCEL_GIT_REPO_SLUG !== 'savingkc-crm') {
  fail(`Vercel repository mismatch: ${process.env.VERCEL_GIT_REPO_SLUG}.`)
}
if (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_OWNER !== 'gxt0x2') {
  fail(`Vercel repository owner mismatch: ${process.env.VERCEL_GIT_REPO_OWNER}.`)
}
if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_REF && process.env.VERCEL_GIT_COMMIT_REF !== manifest.canonicalBranch) {
  fail(`Production deployment attempted from ${process.env.VERCEL_GIT_COMMIT_REF}; only main is allowed.`)
}

if (existsSync(path.join(root, '.git')) && !process.env.VERCEL) {
  try {
    const remote = git(['remote', 'get-url', 'origin'])
    if (!/(?:github\.com[:/])gxt0x2\/savingkc-crm(?:\.git)?$/.test(remote)) fail(`Git origin is not canonical: ${remote}`)
  } catch {
    fail('Unable to verify the canonical git origin.')
  }

  try {
    git(['rev-parse', '--verify', 'origin/main^{commit}'])
    try {
      git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])
    } catch {
      fail('This branch does not contain current origin/main. Rebase or merge main before building a preview.')
    }
  } catch {
    // Hosted build providers may not fetch origin/main. Repository and route
    // identity checks still run there; CI performs the full ancestry check.
  }
}

if (failures.length) {
  console.error('Canonical CRM build gate failed:')
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}

console.log('Canonical CRM build gate passed:', {
  repository: manifest.repository,
  branch: process.env.VERCEL_GIT_COMMIT_REF || 'local',
  vercelProject: manifest.vercelProjectName,
  pipeline: manifest.routes.pipeline,
})
