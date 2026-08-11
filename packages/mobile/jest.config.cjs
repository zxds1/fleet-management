/**
 * Jest config for @fleet/mobile.
 *
 * The Definition of Done (docs/apps/IMPLEMENTATION-PROMPT.md §8) asks for unit tests on
 * `offlineQueue`, `apiClient`, `session` and `socket` "using fakes + Result". Those modules are
 * deliberately written as pure TypeScript with *injected* ports (storage, fetch, clock, socket
 * factory) so they can be exercised in a plain node environment with ts-jest — no Metro, no native
 * modules, no emulator. That keeps `npm run test` deterministic in CI alongside the backend suites.
 *
 * React component/screen code lives behind those ports and is not unit-tested here; it is covered
 * by the EAS build + manual QA per A3.4/A3.5.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@fleet/shared/mobile$': '<rootDir>/../shared/src/mobile.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          jsx: 'react-jsx',
          esModuleInterop: true,
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  collectCoverageFrom: ['src/core/**/*.ts', '!src/core/**/index.ts'],
  coverageThreshold: { global: { lines: 70 } },
};
