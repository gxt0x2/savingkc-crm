import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/lib/manifest/**',
        'src/app/**/dashboard/lib/bottleneck.ts',
        'src/app/**/dashboard/components/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.test.*',
        '**/__tests__/**',
        '**/__fixtures__/**',
      ],
      thresholds: {
        'src/app/(app)/dashboard/lib/bottleneck.ts': {
          statements: 100,
          functions: 100,
          branches: 100,
          lines: 100,
        },
        'src/app/**/dashboard/components/**/*.{ts,tsx}': {
          statements: 90,
          functions: 90,
          branches: 90,
          lines: 90,
        },
      },
    },
  },
})
