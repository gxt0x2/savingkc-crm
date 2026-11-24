import { execFileSync } from 'node:child_process'

export function env(name) {
  return process.env[name] ?? ''
}
export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function repoFromOrigin(cwd = process.cwd()) {
  const configured = env('GITHUB_REPOSITORY')
  if (configured) return configured
  const url = git(['remote', 'get-url', 'origin'], cwd)
  const match = url.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+?)(?:\.git)?$/)
  if (!match) throw new Error('Cannot tell the GitHub repository from origin.')
  return `${match[1]}/${match[2]}`
}

function command(bin, args, input) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    throw new Error(detail || error.message)
  }
}

function token() {
  return env('GITHUB_TOKEN') || env('GH_TOKEN')
}
export function isMissing(error) {
  return /GitHub API 404|HTTP 404|Not Found/i.test(String(error.message))
}

export async function github(path, options = {}) {
  const bearer = token()
  if (!bearer) {
    const args = ['api', '-X', options.method ?? 'GET', path]
    if (options.body) args.push('--input', '-')
    const output = command('gh', args, options.body)
    return output ? JSON.parse(output) : null
  }
  const response = await globalThis.fetch(`https://api.github.com${path}`, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${bearer}`,
      'User-Agent': 'savingkc-crm-guard',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (response.status === 204) return null
  const text = await response.text()
  if (!response.ok) throw new Error(`GitHub API ${response.status} ${path}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

export async function githubPages(path) {
  const items = []
  for (let page = 1; page <= 20; page += 1) {
    const joiner = path.includes('?') ? '&' : '?'
    const batch = await github(`${path}${joiner}per_page=100&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items
}

async function githubJson(path, method, payload) {
  return github(path, { method, body: payload ? JSON.stringify(payload) : undefined })
}

export async function upsertSticky(repo, pr, marker, body) {
  const comments = await githubPages(`/repos/${repo}/issues/${pr}/comments`)
  const matches = comments.filter((comment) => String(comment.body ?? '').includes(marker))
  if (!body) {
    for (const comment of matches) await github(`/repos/${repo}/issues/comments/${comment.id}`, { method: 'DELETE' })
    return
  }
  if (matches.length === 0) {
    await githubJson(`/repos/${repo}/issues/${pr}/comments`, 'POST', { body })
    return
  }
  await githubJson(`/repos/${repo}/issues/comments/${matches[0].id}`, 'PATCH', { body })
  for (const extra of matches.slice(1)) await github(`/repos/${repo}/issues/comments/${extra.id}`, { method: 'DELETE' })
}

export async function addLabel(repo, pr, name, meta) {
  const apply = () => githubJson(`/repos/${repo}/issues/${pr}/labels`, 'POST', { labels: [name] })
  try {
    await apply()
  } catch (error) {
    if (!isMissing(error) || !meta) throw error
    await githubJson(`/repos/${repo}/labels`, 'POST', meta)
    await apply()
  }
}

export async function removeLabel(repo, pr, name) {
  try {
    await github(`/repos/${repo}/issues/${pr}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' })
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

export function isDependabot(pull) {
  const login = String(pull.user?.login ?? '')
  const head = String(pull.head?.ref ?? pull.head ?? '')
  return login === 'dependabot[bot]' || login.startsWith('dependabot') || head.startsWith('dependabot/')
}

export function workstream(branch) {
  if (!branch) return ''
  const match = /^(cursor|codex)\/(.*)-[0-9a-f]{4}$/i.exec(branch)
  return match ? `${match[1]}/${match[2]}` : branch
}

export function isTestFile(file) {
  const name = String(file).replaceAll('\\', '/')
  return /(^|\/)__tests__\//.test(name) || /(^|\/)tests\//.test(name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)
}
