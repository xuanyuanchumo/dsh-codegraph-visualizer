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
        functions: 72,
        statements: 79,
        branches: 75,
      },
      exclude: [
        ...coverageConfigDefaults.exclude,
        'dist/**',
        'coverage/**',
        'test-results/**',
        'src/types/**',
        'src/index.ts',
        'src/client/index.ts',

        'src/client/renderer/IRenderer.ts',
        'src/client/renderer/SequenceDiagramRenderer.tsx',
        'src/client/diagram/SequenceTypes.ts',
        'src/client/renderer/cytoscape-dagre.d.ts',
        'src/client/renderer/cytoscape-fcose.d.ts',
        'src/client/renderer/styles/**',
        'src/client/styles/**',
        'src/client/store/cluster/ClusterStrategy.ts',
        'src/generated/**',
        'scripts/**',
        'playwright.config.ts',
        'tests/**',
        '**/node_modules/**',
        '**/.pnpm/**',
      ],
    },
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx', 'src/**/*.test.ts'],

    environmentMatchGlobs: [
      ['tests/component/**', 'jsdom'],
    ],


    testTimeout: 10000,
    hookTimeout: 10000,



  },
});