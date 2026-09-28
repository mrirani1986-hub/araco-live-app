import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://araco:araco_dev@localhost:5432/araco_spares_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
    env: {
      DATABASE_URL: TEST_DB,
      NODE_ENV: 'test',
      JWT_SECRET: 'test_secret_0123456789abcdefghijklmnopqrstuvwxyz',
      STORAGE_DIR: '../../storage-test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'Admin#Test2026',
    },
  },
});
