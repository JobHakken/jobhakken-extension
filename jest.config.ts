import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Unit tests live under src/. The Playwright e2e (e2e/*.spec.ts) is NOT a Jest suite —
  // keep Jest out of e2e/ (jest matches *.spec.ts by default).
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  // Source uses ESM-style ".js" specifiers on relative TS imports (package is "type":"module").
  // Map them back to the extensionless module so ts-jest resolves the .ts under test.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

export default config;
