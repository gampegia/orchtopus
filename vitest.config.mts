import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tooling/**/*.test.ts'],
    environment: 'node',
    // Many tests spawn git, node-pty or other child processes. On Windows
    // under parallel load these routinely exceed the 5 s default, so the
    // limit is raised once here instead of per test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
