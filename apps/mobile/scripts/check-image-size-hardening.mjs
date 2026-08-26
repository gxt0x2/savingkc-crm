#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const expectedVersion = '2.0.3'
const expectedSource = 'https://codeload.github.com/keyboard-dev/image-size/tar.gz/a42c2e5be4fc729f622f9a6879a643a1f3ff8ca1'
const packageRoot = dirname(dirname(require.resolve('image-size')))
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const lockedSource = packageLock.packages?.['node_modules/image-size']?.resolved

if (packageVersion !== expectedVersion) {
  console.error(`Expected patched image-size ${expectedVersion}, found ${packageVersion}.`)
  process.exit(1)
}

if (lockedSource !== expectedSource) {
  console.error(`Expected image-size source ${expectedSource}, found ${lockedSource ?? 'none'}.`)
  process.exit(1)
}

const probes = [
  {
    name: 'ICNS zero-length entry',
    bytes: Buffer.from([
      0x69, 0x63, 0x6e, 0x73,
      0x00, 0x00, 0x00, 0x10,
      0x69, 0x63, 0x31, 0x30,
      0x00, 0x00, 0x00, 0x00,
    ]),
  },
  {
    name: 'JXL zero-length partial stream',
    bytes: Buffer.from([
      0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x6a, 0x78, 0x6c, 0x20,
      0x00, 0x00, 0x00, 0x00, 0x6a, 0x78, 0x6c, 0x20,
      0x00, 0x00, 0x00, 0x00, 0x6a, 0x78, 0x6c, 0x70,
    ]),
  },
  {
    name: 'HEIF zero-length image property',
    bytes: Buffer.from([
      0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x6d, 0x65, 0x74, 0x61,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x24, 0x69, 0x70, 0x72, 0x70,
      0x00, 0x00, 0x00, 0x1c, 0x69, 0x70, 0x63, 0x6f, 0x00, 0x00, 0x00, 0x00,
      0x69, 0x73, 0x70, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01,
    ]),
  },
]

const runner = `
  const imageSize = require('image-size').default;
  const input = Buffer.from(process.argv[1], 'base64');
  try { imageSize(input); } catch {}
`

for (const probe of probes) {
  const result = spawnSync(process.execPath, ['-e', runner, probe.bytes.toString('base64')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1_000,
  })

  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`${probe.name} timed out; the image parser is still vulnerable.`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`${probe.name} probe failed unexpectedly: ${result.stderr || result.error?.message || result.status}`)
    process.exit(1)
  }
}

for (const asset of [
  'assets/icon.png',
  'assets/splash-icon.png',
  'assets/android-icon-foreground.png',
]) {
  const result = spawnSync(process.execPath, ['-e', `
    const { readFileSync } = require('node:fs');
    const imageSize = require('image-size').default;
    const size = imageSize(readFileSync(process.argv[1]));
    if (!size.width || !size.height) process.exit(2);
  `, asset], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1_000,
  })

  if (result.status !== 0) {
    console.error(`Patched image parser could not read ${asset}: ${result.stderr || result.error?.message || result.status}`)
    process.exit(1)
  }
}

console.log(`Patched image-size ${packageVersion} passed malicious-input and Expo asset probes.`)
