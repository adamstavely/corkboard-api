/**
 * Model evals: the app's real prompts and tools against a real model, on demand (`npm run eval`). They need a key
 * (EVAL_API_KEY) and cost money; without one every case is skipped. Same containers as the integration tests.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/eval'],
  testMatch: ['**/*.eval-spec.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/global-teardown.ts',
  testTimeout: 240_000,
};
