import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000, // first run downloads a MongoDB binary for mongodb-memory-server
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Placeholder only: tests connect to an in-memory MongoDB before any request.
      MONGODB_URI: 'mongodb://127.0.0.1:1/unused',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234567890',
      JWT_EXPIRES_IN: '1h',
    },
  },
});
