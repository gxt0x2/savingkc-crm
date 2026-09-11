#!/usr/bin/env node
// Manual day recovery uses the same receipt, matching, and source-archive path.
// Routine late evidence is recovered by the supervised sync's seven-day replay.
import { sync } from './mojo-sync.mjs'
import { centralDateString } from './mojo-call-evidence.mjs'
const dateIndex = process.argv.indexOf('--date')
const date = dateIndex < 0 ? centralDateString() : process.argv[dateIndex + 1]
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Use --date YYYY-MM-DD')
const result = await sync({ date, dryRun: process.argv.includes('--dry-run') })
process.exitCode = result.ok ? 0 : 1
