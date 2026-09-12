import { spawn } from 'node:child_process'
import { startDisposableDatabase } from './database.mjs'

const port = process.env.EMAIL_LOCAL_PORT || '3210'
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid local port')
const database = await startDisposableDatabase()
console.log(
  `Isolated Email practice app: http://127.0.0.1:${port}. Only fabricated .test contacts; no provider calls.`,
)
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'dev',
    'tests/email-local',
    '--hostname',
    '127.0.0.1',
    '--port',
    port,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EMAIL_LOCAL_DATABASE_URL: database.url,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
)
let cleanup
function stop() {
  // SIGTERM and the child's exit arrive together. Both must await the SAME
  // cleanup, or the child-exit callback can terminate Node before pg_ctl runs.
  cleanup ??= (async () => {
    child.kill('SIGTERM')
    await database.stop()
  })()
  return cleanup
}
process.on('SIGINT', () => {
  stop().then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  stop().then(() => process.exit(0))
})
child.on('exit', async (code) => {
  await stop()
  process.exit(code ?? 0)
})
