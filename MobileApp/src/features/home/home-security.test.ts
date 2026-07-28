import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const productionFiles = [
  'HomeDashboardScreen.tsx',
  'home-api.ts',
  'types.ts',
  'useHomeDashboard.ts',
];

describe('home dashboard data handling', () => {
  it('keeps fetched HR data component-memory-only with no persistence, query cache, or logging API', () => {
    const source = productionFiles
      .map((file) => readFileSync(join(__dirname, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/AsyncStorage|SecureStore|localStorage|sessionStorage/u);
    expect(source).not.toMatch(/react-query|queryClient|persistQueryClient/u);
    expect(source).not.toMatch(/console\.(?:log|debug|info|warn|error)/u);
    expect(source).not.toMatch(/WebSocket|payroll|payslip|document download|push notification/iu);
  });
});
