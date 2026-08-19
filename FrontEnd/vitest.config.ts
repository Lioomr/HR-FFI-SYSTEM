import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Rendering antd tables/selects/pickers under jsdom is slow, and slower
    // still when several component suites run in parallel. The default 5s
    // times out spuriously on loaded machines.
    testTimeout: 20000,
    fileParallelism: false,
  },
});
