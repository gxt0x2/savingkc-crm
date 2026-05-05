import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const cwd = process.cwd()
const srcProxyPath = path.join(cwd, 'src/proxy.ts')
const rootProxyPath = path.join(cwd, 'proxy.ts')
const manifestPath = path.join(cwd, '.next/server/middleware-manifest.json')
const middlewareEntryPath = path.join(cwd, '.next/server/middleware.js')

assert(existsSync(srcProxyPath), 'Proxy registration failed: expected src/proxy.ts beside src/app.')
assert(!existsSync(rootProxyPath), 'Proxy registration failed: root proxy.ts should not exist when app lives under src/app.')
assert(existsSync(manifestPath), 'Proxy registration failed: .next/server/middleware-manifest.json is missing. Run npm run build first.')
assert(existsSync(middlewareEntryPath), 'Proxy registration failed: .next/server/middleware.js is missing. Run npm run build first.')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const middlewareRoutes = Object.keys(manifest.middleware || {})
const middlewareEntry = readFileSync(middlewareEntryPath, 'utf8')
const chunkRefs = Array.from(middlewareEntry.matchAll(/R\.c\("([^"]+)"\)/g), (match) => match[1])
const chunkText = chunkRefs
  .map((chunkRef) => path.join(cwd, '.next', chunkRef))
  .filter((chunkPath) => existsSync(chunkPath))
  .map((chunkPath) => readFileSync(chunkPath, 'utf8'))
  .join('\n')

assert(
  chunkText.includes('x-skc-test-auth-bypass') && chunkText.includes('/api/twilio-token'),
  'Proxy registration failed: built middleware bundle does not include the CRM auth proxy code.'
)

console.log('Proxy registration passed:', {
  srcProxy: 'src/proxy.ts',
  middlewareRoutes,
  middlewareChunks: chunkRefs.length,
})
