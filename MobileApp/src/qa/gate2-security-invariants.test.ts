import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { colors } from '@/design-system';
import { appRoutes } from '@/features/shell/routes';

const sourceRoot = join(__dirname, '..');

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'qa') return [];
      return productionSourceFiles(path);
    }
    if (!['.js', '.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) return [];
    return [path];
  });
}

const productionFiles = productionSourceFiles(sourceRoot);
const productionSource = productionFiles
  .map((file) => `\n/* ${relative(sourceRoot, file)} */\n${readFileSync(file, 'utf8')}`)
  .join('\n');

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe('Gate 2 independent security invariants', () => {
  // The tab set is role-derived (see `(tabs)/_layout.tsx`): employees and HR see the
  // self-service tabs, approver roles see Approvals; the file surface stays bounded.
  it('keeps the public and protected route surface token-free and bounded to the known tabs', () => {
    expect(Object.keys(appRoutes)).toEqual([
      'approvals',
      'attendance',
      'changePassword',
      'home',
      'leave',
      'login',
      'more',
      'notifications',
    ]);

    for (const route of Object.values(appRoutes)) {
      expect(route).toMatch(/^\/[a-z-]+$/u);
      expect(route).not.toMatch(/[?#]|access|refresh|jwt|token|secret/iu);
    }

    const tabDirectory = join(sourceRoot, 'app', '(protected)', '(tabs)');
    const tabScreens = readdirSync(tabDirectory)
      .filter((file) => file.endsWith('.tsx') && file !== '_layout.tsx')
      .map((file) => basename(file, '.tsx'))
      .sort();
    expect(tabScreens).toEqual([
      'approvals',
      'attendance',
      'home',
      'leave',
      'more',
      'notifications',
    ]);

    const rootLayout = readFileSync(join(sourceRoot, 'app', '_layout.tsx'), 'utf8');
    expect(rootLayout).toContain('<Stack.Protected guard={hasBootstrapped && !isAuthenticated}>');
    expect(rootLayout).toContain('<Stack.Protected guard={hasBootstrapped && isAuthenticated}>');
  });

  it('has no browser/plaintext persistence, WebSocket, sensitive logging, or route-param API', () => {
    const forbidden = [
      /AsyncStorage/u,
      /localStorage/u,
      /sessionStorage/u,
      /expo-file-system/u,
      /\bSQLite\b/u,
      /\bWebSocket\b/u,
      /console\.(?:debug|error|info|log|warn)\s*\(/u,
      /dangerouslySetInnerHTML/u,
      /\beval\s*\(/u,
      /new\s+Function\s*\(/u,
      /use(?:Global|Local)SearchParams/u,
    ];

    for (const pattern of forbidden) expect(productionSource).not.toMatch(pattern);
  });

  it('limits credential persistence to the Keychain-backed SecureStore adapter', () => {
    const secureStoreUsers = productionFiles.filter((file) =>
      readFileSync(file, 'utf8').includes("from 'expo-secure-store'"),
    );
    expect(secureStoreUsers.map((file) => relative(sourceRoot, file))).toEqual([
      join('services', 'api', 'secure-credential-store.ts'),
    ]);

    const credentialStoreSource = readFileSync(secureStoreUsers[0], 'utf8');
    expect(credentialStoreSource).toContain('WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    expect(credentialStoreSource).toContain('keychainService: KEYCHAIN_SERVICE');
    expect(credentialStoreSource).not.toMatch(
      /activeCompany|organization|profile|salary|payslip/iu,
    );

    const packageJson = JSON.parse(
      readFileSync(join(sourceRoot, '..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const secureStoreVersion = packageJson.dependencies?.['expo-secure-store'];
    expect(['~15.0.8', '~57.0.1']).toContain(secureStoreVersion);
    if (secureStoreVersion === '~15.0.8') {
      const sdkNotice = readFileSync(join(sourceRoot, '..', 'SDK_VERSION_NOTICE.md'), 'utf8');
      expect(sdkNotice).toContain('Restore Expo SDK 57 before any feature work');
    }
    const appConfig = readFileSync(join(sourceRoot, '..', 'app.config.ts'), 'utf8');
    expect(appConfig).toContain("'expo-secure-store'");
  });

  it('keeps network authority centralized in the fixed-origin API client', () => {
    const networkUsers = productionFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /globalThis\.fetch\.bind|this\.fetchImpl\s*\(/u.test(source);
    });
    expect(networkUsers.map((file) => relative(sourceRoot, file))).toEqual([
      join('services', 'api', 'api-client.ts'),
    ]);

    const apiClientSource = readFileSync(networkUsers[0], 'utf8');
    expect(apiClientSource).toContain(
      'headers.Authorization = `Bearer ${credentials.accessToken}`',
    );
    expect(apiClientSource).toContain("headers['x-active-company-id'] = this.activeCompanyId");
    expect(apiClientSource).toContain("credentials: 'omit'");
    expect(apiClientSource).toContain("redirect: 'error'");
    expect(apiClientSource).toContain("const REFRESH_PATH = '/auth/refresh'");
  });

  it('uses only the verified authentication endpoints and the 20-second REST polling baseline', () => {
    const authSource = readFileSync(join(sourceRoot, 'auth', 'auth-client.ts'), 'utf8');
    expect(authSource).toContain("'/auth/login'");
    expect(authSource).toContain("'/auth/me'");
    expect(authSource).toContain("'/auth/logout'");
    expect(authSource).toContain("'/auth/change-password'");

    const pollingSource = readFileSync(
      join(sourceRoot, 'providers', 'NotificationPollingProvider.tsx'),
      'utf8',
    );
    expect(pollingSource).toContain('const DEFAULT_POLL_INTERVAL_MS = 20_000');
    expect(pollingSource).toContain("'/api/notifications/unread-count/'");
    expect(pollingSource).toContain('clearInterval(timer)');
    expect(pollingSource).toContain('subscription.remove()');
  });

  it('uses the approved orange as an accent without inaccessible orange foreground text', () => {
    expect(contrastRatio(colors.text, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, colors.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.primary, colors.cream)).toBeLessThan(3);
    expect(productionSource).not.toContain('tone="primary"');

    const fieldSource = readFileSync(join(sourceRoot, 'components', 'ui', 'Field.tsx'), 'utf8');
    expect(fieldSource).toMatch(/focused:\s*\{[\s\S]*?borderColor:\s*colors\.text/u);

    const tabsSource = readFileSync(
      join(sourceRoot, 'app', '(protected)', '(tabs)', '_layout.tsx'),
      'utf8',
    );
    expect(tabsSource).toContain('tabBarActiveTintColor: colors.text');
  });
});
