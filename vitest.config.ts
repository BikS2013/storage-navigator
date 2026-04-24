import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/tui/__tests__/**/*.spec.ts'],
    environment: 'node',
    globals: false,
  },
});
