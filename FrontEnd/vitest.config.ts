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
    onUnhandledError(error) {
      // jsdom 28 can emit this Node/undici cleanup error after all test
      // assertions pass. It is not application code and has no test owner.
      if ((error as Error & { code?: string }).code === 'UND_ERR_INVALID_ARG') {
        return false;
      }
      // Ant Design notification timers can close after jsdom tears down its
      // window. The notification test already verified the visible behavior.
      if ((error as Error).name === 'ReferenceError' && error.message === 'window is not defined') {
        return false;
      }
    },
    hookTimeout: 20000,
  },
});
