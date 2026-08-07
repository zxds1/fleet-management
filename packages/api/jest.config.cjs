/** Jest config for @fleet/api (ts-jest preset). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Run the suite in a single process. Turbo runs every package's suite in parallel; spawning many
  // jest worker children across packages saturates the CPU and jest force-kills workers that don't
  // exit in time ("worker process failed to exit gracefully"). A single process per package stays
  // within core count and avoids the warning, while keeping package-level parallelism fast.
  maxWorkers: 1,
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/services/**/*.ts',
    'src/middleware/**/*.ts',
    'src/http/**/*.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: { global: { lines: 80 } },
};
