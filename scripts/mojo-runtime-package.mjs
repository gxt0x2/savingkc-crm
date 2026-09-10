#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entries = ['mojo-supervised-runner.mjs', 'mojo-cron-runner.mjs', 'mojo-extract-session.mjs',
  'mojo-sync.mjs', 'mojo-eod-sweep.mjs', 'mojo-kpi-snapshot.mjs', 'mojo-runtime-package.mjs'].map(name => `scripts/${name}`)
const hash = value => createHash('sha256').update(value).digest('hex')
export function runtimeFiles(root) {
  const visited = new Set()
  function visit(relative) {
    if (visited.has(relative)) return
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Dependency outside runtime root')
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    visited.add(relative)
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) visit(path.normalize(path.join(path.dirname(relative), match[1])))
    }
  }
  for (const entry of entries) visit(entry)
  return [...visited].sort()
}
export function stageRuntime(root, destination) {
  const files = Object.fromEntries(runtimeFiles(root).map(relative => {
    const contents = fs.readFileSync(path.join(root, relative))
    fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true })
    fs.writeFileSync(path.join(destination, relative), contents, { mode: 0o700 })
    return [relative, hash(contents)]
  }))
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const manifest = { revision, contentDigest: hash(JSON.stringify(files)), files }
  fs.writeFileSync(path.join(destination, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  return manifest
}
export function verifyRuntime(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'))
  if (hash(JSON.stringify(manifest.files)) !== manifest.contentDigest) throw new Error('Runtime manifest checksum mismatch')
  for (const relative of runtimeFiles(root)) {
    if (hash(fs.readFileSync(path.join(root, relative))) !== manifest.files[relative]) throw new Error(`Runtime checksum mismatch: ${relative}`)
    execFileSync(process.execPath, ['--check', path.join(root, relative)], { stdio: 'pipe' })
  }
  return manifest
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = process.argv[2] === '--stage' ? stageRuntime(root, process.argv[3])
    : process.argv[2] === '--verify' ? verifyRuntime(process.argv[3] || root) : null
  if (!result) throw new Error('Use --stage DIRECTORY or --verify [DIRECTORY]')
  console.log(`Mojo runtime verified: ${result.revision}, content=${result.contentDigest}, files=${Object.keys(result.files).length}`)
}
