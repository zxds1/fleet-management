/** Jest config for @fleet/api (ts-jest preset). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
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
