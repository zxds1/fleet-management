/** Jest config for @fleet/shared (ts-jest preset). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts', '!src/types/**', '!src/schemas/**'],
  coverageThreshold: { global: { lines: 80 } },
};
