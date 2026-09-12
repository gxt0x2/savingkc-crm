import path from 'node:path'
import { fileURLToPath } from 'node:url'
export default {
  devIndicators: false,
  experimental: { externalDir: true },
  turbopack: {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  },
}
