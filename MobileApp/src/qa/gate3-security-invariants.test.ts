import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

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

/**
 * Every server path the employee client is allowed to call. Adding a row here is a
 * deliberate contract decision that must be verified against the Django routes and
 * `plans/API Route Status Matrix.md` first.
 */
const ALLOWED_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/change-password',
  '/auth/me',
  '/api/attendance/me/',
  '/api/attendance/me/check-in/',
  '/api/attendance/me/check-out/',
  '/api/leaves/employee/leave-balance/',
  '/api/leaves/employee/leave-requests/',
  '/api/leaves/leave-types/',
  // Approver surface (Phase 2). `/api/leaves/leave-requests/` is shared with the
  // employee submit action: HR's wider view comes from the server-side queryset,
  // not from a different path. The `{id}/approve/` and `{id}/reject/` suffixes are
  // built at runtime from these bases, exactly like `{id}/cancel/`, so the literal
  // scanner needs no separate entries. Neither string collides with the rejected
  // legacy literal `/api/leaves/hr/`.
  '/api/leaves/leave-requests/',
  '/api/leaves/ceo/leave-requests/',
  '/api/core/workflow/delegations/',
  '/api/employees/delegation-candidates/',
  '/api/notifications/',
  '/api/notifications/unread-count/',
  '/api/notifications/read-all/',
  '/api/announcements/',
  '/api/employees/me/',
  '/api/employees/me/documents/',
  '/employee/payslips/',
] as const;

function literalPaths(source: string): string[] {
  return [...source.matchAll(/(['"`])(\/(?:api|auth|employee|ws)\/[^'"`\s]*)\1/gu)].map(
    (match) => match[2],
  );
}

describe('Gate 3 independent API and security invariants', () => {
  it('calls only endpoints verified against the Django routes and the route matrix', () => {
    const used = new Set(literalPaths(productionSource));

    for (const path of used) {
      const base = path.split('?')[0];
      expect(ALLOWED_PATHS).toContain(base);
    }
    expect(used.size).toBeGreaterThan(0);
  });

  it('never uses the legacy or unverified employee routes the matrix rejects', () => {
    for (const legacy of [
      '/employee/summary',
      '/employee/profile',
      '/employee/status',
      'attachment-public',
      '/ws/notifications/',
      '/leave-balances/',
      '/api/leaves/hr/',
    ]) {
      expect(productionSource).not.toContain(legacy);
    }

    // The duplicated root-level `/employees/*` family must never be addressed directly.
    expect(literalPaths(productionSource).filter((path) => path.startsWith('/employees/'))).toEqual(
      [],
    );
  });

  it('keeps every mutation on the owner-scoped self-service actions', () => {
    const attendance = readFileSync(
      join(sourceRoot, 'features', 'attendance', 'attendance-api.ts'),
      'utf8',
    );
    const leave = readFileSync(join(sourceRoot, 'features', 'leave', 'leave-api.ts'), 'utf8');

    expect(attendance).toContain("'/api/attendance/me/check-in/'");
    expect(attendance).toContain("'/api/attendance/me/check-out/'");

    // The create body carries only the verified fields; ownership stays server-fixed.
    const submitBody = leave.slice(leave.indexOf('export async function submitLeaveRequest'));
    expect(submitBody).toContain('leave_type: draft.leaveTypeId');
    expect(submitBody).not.toMatch(/employee_id|employee_profile|leave_type_id|company/u);
  });

  it('sends no client-chosen ownership, company, or role selector in any request body', () => {
    const apiModules = productionFiles.filter((file) => /-api\.ts$/u.test(file));
    expect(apiModules.length).toBeGreaterThanOrEqual(4);

    for (const file of apiModules) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/employee_id\s*:/u);
      expect(source).not.toMatch(/company_id\s*:/u);
      expect(source).not.toMatch(/\brole\s*:/u);
      // Company scope travels only in the central client header, never in a path or body.
      expect(source).not.toMatch(/company_id=|\?company|&company/u);
    }
  });

  it('keeps the route surface bounded, token-free, and free of record identifiers', () => {
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
    }

    // Detail views are driven by in-memory selection, never by navigation parameters.
    expect(productionSource).not.toMatch(/use(?:Global|Local)SearchParams/u);
    expect(productionSource).not.toMatch(/router\.(?:push|replace)\([^)]*\$\{/u);
  });

  it('does not persist, cache, or download HR data to the device', () => {
    for (const pattern of [
      /AsyncStorage/u,
      /localStorage/u,
      /sessionStorage/u,
      /expo-file-system/u,
      /\bSQLite\b/u,
      /downloadAsync|writeAsStringAsync|createDownloadResumable/u,
      /expo-sharing/u,
      /MMKV/u,
    ]) {
      expect(productionSource).not.toMatch(pattern);
    }

    const secureStoreUsers = productionFiles.filter((file) =>
      readFileSync(file, 'utf8').includes("from 'expo-secure-store'"),
    );
    expect(secureStoreUsers.map((file) => relative(sourceRoot, file))).toEqual([
      join('services', 'api', 'secure-credential-store.ts'),
    ]);
  });

  it('keeps realtime deferred and every request on authenticated REST polling', () => {
    expect(productionSource).not.toMatch(/\bWebSocket\b|socket\.io|EventSource/u);
    const polling = readFileSync(
      join(sourceRoot, 'providers', 'NotificationPollingProvider.tsx'),
      'utf8',
    );
    expect(polling).toContain('const DEFAULT_POLL_INTERVAL_MS = 20_000');
    expect(polling).toContain('clearInterval(timer)');
  });

  it('logs nothing and evaluates nothing at runtime', () => {
    for (const pattern of [
      /console\.(?:debug|error|info|log|warn)\s*\(/u,
      /\beval\s*\(/u,
      /new\s+Function\s*\(/u,
      /dangerouslySetInnerHTML/u,
      /\bWebView\b/u,
    ]) {
      expect(productionSource).not.toMatch(pattern);
    }
  });

  it('surfaces server text only through the sanitized validation channel', () => {
    const apiError = readFileSync(join(sourceRoot, 'services', 'api', 'api-error.ts'), 'utf8');
    expect(apiError).toContain('const VALIDATION_STATUSES = Object.freeze([400, 422])');
    expect(apiError).toContain('UNSAFE_DETAIL_PATTERN');

    const apiClient = readFileSync(join(sourceRoot, 'services', 'api', 'api-client.ts'), 'utf8');
    expect(apiClient).toContain(
      'if (response.status !== 400 && response.status !== 422) return [];',
    );

    // No screen may render a raw response body or error message from the transport.
    expect(productionSource).not.toMatch(
      /error\.message|response\.statusText|await response\.text/u,
    );
  });

  it('projects no compensation or identity-document field into the profile feature', () => {
    const moreApi = readFileSync(join(sourceRoot, 'features', 'more', 'more-api.ts'), 'utf8');
    const profileSection = moreApi.slice(
      moreApi.indexOf('export function parseProfile'),
      moreApi.indexOf('export function parsePayslipSummary'),
    );

    for (const field of [
      'basic_salary',
      'total_salary',
      'transportation_allowance',
      'passport',
      'national_id',
      'date_of_birth',
      'iqama',
    ]) {
      expect(profileSection).not.toContain(field);
    }
  });

  it('keeps status meaning available without colour perception', () => {
    const badge = readFileSync(join(sourceRoot, 'components', 'ui', 'StatusBadge.tsx'), 'utf8');
    expect(badge).toContain('label: string');
    expect(badge).toContain('glyph');

    const status = readFileSync(join(sourceRoot, 'features', 'shared', 'status.ts'), 'utf8');
    const presentations = [...status.matchAll(/\{\s*labelKey:[^}]*\}/gu)].map((match) => match[0]);
    expect(presentations.length).toBeGreaterThan(20);
    for (const presentation of presentations) {
      expect(presentation).toMatch(/glyph:/u);
      expect(presentation).toMatch(/tone:/u);
    }
  });

  it('renders every screen through direction-aware helpers rather than physical sides', () => {
    const screens = productionFiles.filter((file) => /Screen\.tsx$|Sheet\.tsx$/u.test(file));
    expect(screens.length).toBeGreaterThanOrEqual(6);

    for (const file of screens) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\bmarginLeft:|\bmarginRight:|\bpaddingLeft:|\bpaddingRight:/u);
      expect(source).not.toMatch(/textAlign:\s*'(?:left|right)'/u);
    }
  });

  it('keeps interactive surfaces at or above the 44 point minimum target', () => {
    for (const [file, expectation] of [
      ['components/ui/ListRow.tsx', /minHeight:\s*layout\.minTouchTarget/u],
      ['components/ui/StatusBadge.tsx', /paddingVertical/u],
      ['features/more/LanguageSelector.tsx', /minHeight:\s*layout\.minTouchTarget/u],
      ['features/leave/LeaveRequestForm.tsx', /minHeight:\s*layout\.minTouchTarget/u],
    ] as const) {
      expect(readFileSync(join(sourceRoot, ...file.split('/')), 'utf8')).toMatch(expectation);
    }
  });

  it('never persists the in-app language choice', () => {
    const provider = readFileSync(join(sourceRoot, 'i18n', 'LocalizationProvider.tsx'), 'utf8');
    expect(provider).toMatch(/useState<SupportedLanguage \| null>/u);
    expect(provider).not.toMatch(/SecureStore|setItem|storage/iu);
  });
});
