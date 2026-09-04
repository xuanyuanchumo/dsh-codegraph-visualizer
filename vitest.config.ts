import { defineConfig } from 'vitest/config';
import { coverageConfigDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        lines: 79,
        functions: 73,
        statements: 79,
        branches: 65,
      },
      exclude: [
        ...coverageConfigDefaults.exclude,
        'dist/**',
        'coverage/**',
        'test-results/**',
        'src/types/**',
        'src/index.ts',
        'src/client/index.ts',
        'src/client/GraphPanel.tsx',
        'src/client/renderer/**',
        'src/client/hooks/**',
        'src/client/components/**',
        'src/client/styles.css',
        'src/generated/**',
        'scripts/**',
        'playwright.config.ts',
        'tests/**',
        '**/node_modules/**',
        '**/.pnpm/**',
      ],
    },
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});