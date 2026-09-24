import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Same Babel transform as vite.config.ts: lib/ modules use the Lingui macros
  // (`t`, `msg` from @lingui/core/macro), which must be compiled before running.
  // `as any`: vitest bundles its own vite typings, which do not match the ones of @vitejs/plugin-react.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }) as any],
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
    setupFiles: ['lib/__tests__/setup.ts'],
  },
});
