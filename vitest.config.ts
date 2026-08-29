import { defineConfig } from 'vitest/config';
import { coverageConfigDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        ...coverageConfigDefaults.thresholds,
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 65,
      },
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/types/**',
        'src/client/index.ts',
        'src/client/GraphPanel.tsx',
        'src/client/renderer/**',
        'src/client/styles.css',
        'scripts/**',
        'playwright.config.ts',
        'tests/**',
      ],
    },
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});